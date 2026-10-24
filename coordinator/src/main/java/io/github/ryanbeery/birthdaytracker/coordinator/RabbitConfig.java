package io.github.ryanbeery.birthdaytracker.coordinator;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The queues and the exchange the coordinator uses, and how it reads and writes their messages. */
@Configuration(proxyBeanMethods = false)
class RabbitConfig {

    static final String SUBMISSIONS_QUEUE = "birthday.submissions";
    static final String SUBMISSIONS_DEAD_LETTER_QUEUE = "birthday.submissions.dlq";
    static final String REMINDERS_EXCHANGE = "birthday.reminders";
    static final String REMINDERS_QUEUE = "birthday.reminders.email";

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

    // A fanout exchange copies each reminder to every queue bound to it, as an SNS topic would.
    @Bean
    FanoutExchange remindersExchange() {
        return ExchangeBuilder.fanoutExchange(REMINDERS_EXCHANGE).durable(true).build();
    }

    // Stands in for the queue the email service would own, and keeps reminders until something
    // reads them. RabbitMQ drops a message that no queue receives, so without a bound queue,
    // every reminder would fail to publish.
    @Bean
    Queue remindersQueue() {
        return QueueBuilder.durable(REMINDERS_QUEUE).build();
    }

    @Bean
    Binding remindersBinding(Queue remindersQueue, FanoutExchange remindersExchange) {
        return BindingBuilder.bind(remindersQueue).to(remindersExchange);
    }

    // Reads each JSON body into the listener's parameter type. Fields the contract doesn't
    // have are ignored, so the API can add one before the coordinator reads it.
    @Bean
    MessageConverter messageConverter() {
        return new JacksonJsonMessageConverter();
    }
}
