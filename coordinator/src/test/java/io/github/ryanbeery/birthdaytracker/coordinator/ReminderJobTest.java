package io.github.ryanbeery.birthdaytracker.coordinator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import tools.jackson.databind.json.JsonMapper;

/**
 * The daily reminder run, against real PostgreSQL and RabbitMQ, on a fixed date. Each test
 * calls the job directly. The schedule is switched off, so the job never runs on its own here.
 */
@SpringBootTest(properties = "reminders.cron=-")
@Import(TestcontainersConfiguration.class)
class ReminderJobTest {

    // The queue the coordinator binds to the birthday.reminders exchange. It stands in for
    // the queue the email service would read.
    private static final String REMINDERS_QUEUE = "birthday.reminders.email";

    private static final UUID ADA = UUID.fromString("5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90");
    private static final UUID GRACE = UUID.fromString("9c4f2b7e-3d1a-4e8b-b6c5-7a2e1f0d3c84");

    // Ada's next birthday, so the occurrence her reminder is for.
    private static final LocalDate ADA_OCCURRENCE = LocalDate.of(2026, 12, 10);
    // An eventId is the birthday's id and the occurrence date, so every copy of a reminder has the same one.
    private static final String ADA_EVENT_ID = "5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90:2026-12-10";

    // Every test runs the job at midnight UTC on Dec 3, 2026, when the daily run fires.
    @TestBean
    Clock clock;

    static Clock clock() {
        return Clock.fixed(Instant.parse("2026-12-03T00:00:00Z"), ZoneOffset.UTC);
    }

    @Autowired
    ReminderJob job;

    @Autowired
    RabbitTemplate rabbit;

    @Autowired
    AmqpAdmin admin;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    Binding remindersBinding;

    // The real beans, wrapped so a test can make one fail or count its calls.
    @MockitoSpyBean
    BirthdayRepository birthdays;

    @MockitoSpyBean
    ReminderCalculator calculator;

    private final JsonMapper json = JsonMapper.builder().build();

    @BeforeEach
    void startEmpty() {
        jdbc.sql("TRUNCATE birthdays").update();
        admin.purgeQueue(REMINDERS_QUEUE);
    }

    @Test
    void publishesAReminderWithEveryContractField() {
        saveAda("A first edition of her notes");

        job.run();

        Message reminder = rabbit.receive(REMINDERS_QUEUE);
        assertThat(reminder).isNotNull();
        assertThat(json.readTree(reminder.getBody())).isEqualTo(json.readTree("""
                {
                  "eventId": "5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90:2026-12-10",
                  "type": "birthday.reminder",
                  "birthdayId": "5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90",
                  "name": "Ada Lovelace",
                  "email": "ada@example.com",
                  "birthday": "1990-12-10",
                  "occurrenceDate": "2026-12-10",
                  "turningAge": 36,
                  "giftIdeas": "A first edition of her notes",
                  "reminderWindowDays": 7,
                  "generatedAt": "2026-12-03T00:00:00Z"
                }
                """));
        // Persistent JSON, like the submissions the API publishes.
        MessageProperties properties = reminder.getMessageProperties();
        assertThat(properties.getContentType()).isEqualTo(MessageProperties.CONTENT_TYPE_JSON);
        assertThat(properties.getReceivedDeliveryMode()).isEqualTo(MessageDeliveryMode.PERSISTENT);
    }

    @Test
    void recordsTheOccurrenceSoASecondRunSendsNothing() {
        saveAda("A first edition of her notes");

        job.run();
        job.run();

        assertThat(takeQueuedEventIds()).containsExactly(ADA_EVENT_ID);
        assertThat(lastRemindedOccurrence(ADA)).contains(ADA_OCCURRENCE);
    }

    @Test
    void skipsABirthdayWhoseWindowHasNotOpened() {
        saveAda("A first edition of her notes");
        saveGrace();

        job.run();

        assertThat(takeQueuedEventIds()).containsExactly(ADA_EVENT_ID);
        assertThat(lastRemindedOccurrence(GRACE)).isEmpty();
    }

    @Test
    void leavesGiftIdeasOutWhenThereAreNone() {
        saveAda(null);

        job.run();

        Message reminder = rabbit.receive(REMINDERS_QUEUE);
        assertThat(reminder).isNotNull();
        assertThat(json.readTree(reminder.getBody()).has("giftIdeas")).isFalse();
    }

    @Test
    void recordsNothingWhenNoQueueReceivesTheReminder() {
        saveAda("A first edition of her notes");
        // With no queue bound to the exchange, RabbitMQ accepts the reminder and drops it.
        admin.removeBinding(remindersBinding);
        try {
            assertThatThrownBy(job::run).isInstanceOf(AmqpException.class);
            assertThat(lastRemindedOccurrence(ADA)).isEmpty();
        } finally {
            admin.declareBinding(remindersBinding);
        }

        // So the next run, with the queue bound again, still sends it.
        job.run();

        assertThat(takeQueuedEventIds()).containsExactly(ADA_EVENT_ID);
        assertThat(lastRemindedOccurrence(ADA)).contains(ADA_OCCURRENCE);
    }

    @Test
    void sendsTheReminderAgainWhenRecordingItFails() {
        saveAda("A first edition of her notes");
        // The reminder is published, then recording it fails as if the database connection
        // dropped. The next run records it for real.
        doThrow(new TransientDataAccessResourceException("Connection reset"))
                .doCallRealMethod()
                .when(birthdays).markReminded(any(), any());

        assertThatThrownBy(job::run).isInstanceOf(TransientDataAccessResourceException.class);
        assertThat(lastRemindedOccurrence(ADA)).isEmpty();
        job.run();

        // A duplicate with the same eventId, which the email service can drop, rather than a
        // missed reminder.
        assertThat(takeQueuedEventIds()).containsExactly(ADA_EVENT_ID, ADA_EVENT_ID);
        assertThat(lastRemindedOccurrence(ADA)).contains(ADA_OCCURRENCE);
    }

    @Test
    void readsTodaysDateOncePerRun() {
        saveAda("A first edition of her notes");
        saveGrace();

        job.run();

        // So a run that crosses midnight judges every birthday by the same date.
        verify(calculator, times(1)).today();
    }

    /** Ada's birthday, Dec 10, is 7 days away: the first day of her 7-day window. */
    private void saveAda(String giftIdeas) {
        birthdays.insert(new SubmissionMessage(
                ADA, "Ada Lovelace", "ada@example.com", LocalDate.of(1990, 12, 10), 7, giftIdeas));
    }

    /** Grace's birthday, Dec 9, is 6 days away, but her 5-day window doesn't open until tomorrow. */
    private void saveGrace() {
        birthdays.insert(new SubmissionMessage(
                GRACE, "Grace Hopper", "grace@example.com", LocalDate.of(1906, 12, 9), 5, null));
    }

    /** The birthday's last_reminded_occurrence, empty until a reminder for it is recorded. */
    private Optional<LocalDate> lastRemindedOccurrence(UUID id) {
        return jdbc.sql("SELECT last_reminded_occurrence FROM birthdays WHERE id = :id")
                .param("id", id)
                .query((row, rowNumber) -> Optional.ofNullable(row.getObject(1, LocalDate.class)))
                .single();
    }

    /** Takes every reminder off the queue and returns their eventIds, oldest first. */
    private List<String> takeQueuedEventIds() {
        List<String> eventIds = new ArrayList<>();
        Message reminder = rabbit.receive(REMINDERS_QUEUE);
        while (reminder != null) {
            eventIds.add(json.readTree(reminder.getBody()).get("eventId").asString());
            reminder = rabbit.receive(REMINDERS_QUEUE);
        }
        return eventIds;
    }
}
