package io.github.ryanbeery.birthdaytracker.coordinator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.json.JsonMapper;

/**
 * The coordinator's half of the submit flow, against real PostgreSQL (built from
 * db/init.sql) and RabbitMQ. Each test publishes a message the way the API does.
 */
@SpringBootTest(properties = {
        // Retry after 10 ms instead of seconds, so the dead-letter tests are quick.
        "spring.rabbitmq.listener.simple.retry.initial-interval=10ms",
        "spring.rabbitmq.listener.simple.retry.max-interval=10ms"
})
@Import(TestcontainersConfiguration.class)
@ExtendWith(OutputCaptureExtension.class)
class SubmissionListenerTest {

    private static final String QUEUE = "birthday.submissions";
    private static final String DEAD_LETTER_QUEUE = "birthday.submissions.dlq";

    private static final UUID ID = UUID.fromString("5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90");

    // The fields the API publishes (api/src/app.ts), in the same order.
    private static final String SUBMISSION = """
            {
              "id": "5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90",
              "name": "Ada Lovelace",
              "email": "ada@example.com",
              "birthday": "1990-12-10",
              "reminderWindowDays": 7,
              "giftIdeas": "A first edition of her notes",
              "submittedAt": "2026-10-22T00:30:00.000Z"
            }
            """;

    /** A row of the birthdays table. JdbcClient maps each column to the component of the same name. */
    record BirthdayRow(
            UUID id,
            String name,
            String email,
            LocalDate birthday,
            int reminderWindowDays,
            String giftIdeas,
            LocalDate lastRemindedOccurrence,
            OffsetDateTime createdAt) {
    }

    /** contracts/submission-queue.json, the declaration both services must match. */
    record QueueContract(String queue, boolean durable, Map<String, Object> arguments) {
    }

    @Autowired
    RabbitTemplate rabbit;

    @Autowired
    AmqpAdmin admin;

    @Autowired
    JdbcClient jdbc;

    // The real repository, wrapped so a test can count its calls or make one fail.
    @MockitoSpyBean
    BirthdayRepository birthdays;

    @BeforeEach
    void startEmpty() {
        jdbc.sql("TRUNCATE birthdays").update();
        admin.purgeQueue(DEAD_LETTER_QUEUE);
    }

    @Test
    void savesASubmissionWithEveryField() {
        publish(SUBMISSION);

        await().untilAsserted(() -> assertThat(rows()).hasSize(1));
        BirthdayRow row = rows().getFirst();
        assertThat(row.id()).isEqualTo(ID);
        assertThat(row.name()).isEqualTo("Ada Lovelace");
        assertThat(row.email()).isEqualTo("ada@example.com");
        assertThat(row.birthday()).isEqualTo(LocalDate.of(1990, 12, 10));
        assertThat(row.reminderWindowDays()).isEqualTo(7);
        assertThat(row.giftIdeas()).isEqualTo("A first edition of her notes");
        assertThat(row.lastRemindedOccurrence()).isNull();
        assertThat(row.createdAt()).isNotNull();
    }

    @Test
    void savesNullGiftIdeasWhenTheMessageHasNone() {
        // The API leaves giftIdeas out when it's blank.
        publish(SUBMISSION.replace("\"giftIdeas\": \"A first edition of her notes\",", ""));

        await().untilAsserted(() -> assertThat(rows()).hasSize(1));
        assertThat(rows().getFirst().giftIdeas()).isNull();
    }

    @Test
    void ignoresARedeliveryOfASavedSubmission(CapturedOutput output) {
        publish(SUBMISSION);
        publish(SUBMISSION);

        await().untilAsserted(() -> assertThat(output).contains("Duplicate delivery ignored"));
        // One insert per copy and no retries, so the second copy was acked.
        verify(birthdays, times(2)).insert(any());
        assertThat(rows()).hasSize(1);
        assertThat(deadLetterCount()).isZero();
    }

    @Test
    void retriesABriefDatabaseError() {
        // The first insert fails as if the connection dropped. The retry runs the real one.
        doThrow(new TransientDataAccessResourceException("Connection reset"))
                .doCallRealMethod()
                .when(birthdays).insert(any());

        publish(SUBMISSION);

        await().untilAsserted(() -> assertThat(rows()).hasSize(1));
        verify(birthdays, times(2)).insert(any());
        assertThat(deadLetterCount()).isZero();
    }

    @Test
    void deadLettersASubmissionTheDatabaseRejects() {
        // The table's CHECK constraint allows a window of 1 to 14 days.
        String windowOf15 = SUBMISSION.replace("\"reminderWindowDays\": 7", "\"reminderWindowDays\": 15");

        publish(windowOf15);

        Message deadLetter = rabbit.receive(DEAD_LETTER_QUEUE, 10_000);
        assertThat(deadLetter).isNotNull();
        assertThat(new String(deadLetter.getBody(), StandardCharsets.UTF_8)).isEqualTo(windowOf15);
        // The first try plus 3 retries.
        verify(birthdays, times(4)).insert(any());
        assertThat(rows()).isEmpty();
    }

    @Test
    void deadLettersMalformedJsonWithoutTryingToSaveIt() {
        publish("{\"id\": ");

        assertThat(rabbit.receive(DEAD_LETTER_QUEUE, 10_000)).isNotNull();
        verify(birthdays, never()).insert(any());
        assertThat(rows()).isEmpty();
    }

    @Test
    void declaresTheQueueAsTheSharedContractDescribes() {
        // The API's tests check its declaration against the same file. RabbitMQ refuses a
        // declaration whose arguments differ from the existing queue's, with 406 PRECONDITION_FAILED.
        QueueContract contract = JsonMapper.builder().build()
                .readValue(new File("../contracts/submission-queue.json"), QueueContract.class);

        assertThatNoException().isThrownBy(() -> rabbit.execute(channel -> {
            channel.queueDeclarePassive(contract.queue());  // fails unless the coordinator declared it
            return channel.queueDeclare(contract.queue(), contract.durable(), false, false, contract.arguments());
        }));
    }

    @Test
    void ignoresAFieldTheContractDoesNotHave() {
        // Even a field named after a real column must not reach the table.
        String withExtraField = SUBMISSION.replace(
                "\"submittedAt\"",
                "\"lastRemindedOccurrence\": \"2026-12-01\", \"submittedAt\"");

        publish(withExtraField);

        await().untilAsserted(() -> assertThat(rows()).hasSize(1));
        assertThat(rows().getFirst().lastRemindedOccurrence()).isNull();
    }

    /** Publishes JSON the way the API does: persistent, application/json, no Java type headers. */
    private void publish(String json) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        rabbit.send(QUEUE, new Message(json.getBytes(StandardCharsets.UTF_8), properties));
    }

    private List<BirthdayRow> rows() {
        return jdbc.sql("SELECT * FROM birthdays").query(BirthdayRow.class).list();
    }

    private long deadLetterCount() {
        return admin.getQueueInfo(DEAD_LETTER_QUEUE).getMessageCount();
    }
}
