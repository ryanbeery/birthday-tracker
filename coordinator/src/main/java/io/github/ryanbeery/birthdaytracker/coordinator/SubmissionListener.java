package io.github.ryanbeery.birthdaytracker.coordinator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Saves each submission the API publishes to birthday.submissions. */
@Component
class SubmissionListener {

    private static final Logger log = LoggerFactory.getLogger(SubmissionListener.class);

    private final BirthdayRepository birthdays;

    SubmissionListener(BirthdayRepository birthdays) {
        this.birthdays = birthdays;
    }

    // The transaction commits as this method returns, and RabbitMQ gets the ack only after
    // that, so a message is never acked before its row is saved. If the insert or the commit
    // throws, the message is retried and then dead-lettered (see application.yml).
    @Transactional
    @RabbitListener(queues = RabbitConfig.SUBMISSIONS_QUEUE)
    public void save(SubmissionMessage submission) {
        // Log only the id: names and emails are personal data.
        if (birthdays.insert(submission)) {
            log.info("Saved birthday {}", submission.id());
        } else {
            log.info("Duplicate delivery ignored: birthday {} is already saved", submission.id());
        }
    }
}
