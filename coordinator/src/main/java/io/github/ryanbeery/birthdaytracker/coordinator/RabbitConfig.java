package io.github.ryanbeery.birthdaytracker.coordinator;

import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The queues the coordinator reads, and how it reads their messages. */
@Configuration(proxyBeanMethods = false)
class RabbitConfig {

    static final String SUBMISSIONS_QUEUE = "birthday.submissions";
    static final String SUBMISSIONS_DEAD_LETTER_QUEUE = "birthday.submissions.dlq";

    // The API declares this queue too, and RabbitMQ refuses a second declaration whose
    // arguments differ. Both must match contracts/submission-queue.json, which a test on
    // each side checks.
    @Bean
    Queue submissionsQueue() {
        return QueueBuilder.durable(SUBMISSIONS_QUEUE)
                // A rejected message goes to the default exchange (""), which routes it to
                // the queue named by the routing key.
                .deadLetterExchange("")
                .deadLetterRoutingKey(SUBMISSIONS_DEAD_LETTER_QUEUE)
                .build();
    }

    // Only the coordinator declares this queue. Without it, RabbitMQ would drop
    // dead-lettered messages, because their routing key would match no queue.
    @Bean
    Queue submissionsDeadLetterQueue() {
        return QueueBuilder.durable(SUBMISSIONS_DEAD_LETTER_QUEUE).build();
    }

    // Reads each JSON body into the listener's parameter type. Fields the contract doesn't
    // have are ignored, so the API can add one before the coordinator reads it.
    @Bean
    MessageConverter messageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
