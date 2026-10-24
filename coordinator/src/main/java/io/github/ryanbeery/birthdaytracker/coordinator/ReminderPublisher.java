package io.github.ryanbeery.birthdaytracker.coordinator;

import java.util.concurrent.TimeUnit;

import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

/** Publishes reminders to the birthday.reminders exchange. */
@Component
class ReminderPublisher {

    private final RabbitTemplate rabbit;

    ReminderPublisher(RabbitTemplate rabbit) {
        this.rabbit = rabbit;
    }

    /**
     * Returns only once a queue has the reminder, so the job never records one that was lost.
     * Throws otherwise, or if RabbitMQ doesn't answer within 5 seconds.
     */
    void publish(ReminderMessage reminder) {
        CorrelationData confirmation = new CorrelationData();
        rabbit.convertAndSend(RabbitConfig.REMINDERS_EXCHANGE, "", reminder, confirmation);

        // RabbitMQ acks a message it has stored, or nacks one it can't take.
        // join() throws if neither answer comes within 5 seconds.
        CorrelationData.Confirm confirm = confirmation.getFuture().orTimeout(5, TimeUnit.SECONDS).join();

        // RabbitMQ also acks a message that no queue received. The template publishes as
        // mandatory (see application.yml), so such a message comes back first, as getReturned().
        if (!confirm.ack() || confirmation.getReturned() != null) {
            throw new AmqpException("RabbitMQ didn't queue reminder " + reminder.eventId());
        }
    }
}
