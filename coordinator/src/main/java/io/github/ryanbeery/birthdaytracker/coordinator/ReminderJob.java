package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Once a day, publishes a reminder for each birthday whose reminder window is open. */
@Component
class ReminderJob {

    private static final Logger log = LoggerFactory.getLogger(ReminderJob.class);

    private final BirthdayRepository birthdays;
    private final ReminderCalculator calculator;
    private final ReminderPublisher publisher;
    private final Clock clock;

    ReminderJob(
            BirthdayRepository birthdays,
            ReminderCalculator calculator,
            ReminderPublisher publisher,
            Clock clock) {
        this.birthdays = birthdays;
        this.calculator = calculator;
        this.publisher = publisher;
        this.clock = clock;
    }

    // reminders.cron is daily, and every minute in the local profile that Compose uses
    // (see application.yml).
    @Scheduled(cron = "${reminders.cron}", zone = "UTC")
    void run() {
        // Read the date once, so a run that crosses midnight judges every birthday by the same day.
        LocalDate today = calculator.today();
        // Trimmed to milliseconds, like the API's submittedAt.
        Instant generatedAt = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        int sent = 0;

        for (SavedBirthday birthday : birthdays.findAll()) {
            NextBirthday next = calculator.next(birthday.birthday(), today);
            boolean due = calculator.isReminderDue(
                    next, birthday.reminderWindowDays(), birthday.lastRemindedOccurrence());
            if (!due) {
                continue;
            }

            // Publish first, then record. If the coordinator stops in between, the next run sends
            // the reminder again with the same eventId, and the email service drops the copy.
            // Recording first could lose a reminder instead. A failure in either step ends the
            // run, and the next run sends whatever is still due.
            ReminderMessage reminder = ReminderMessage.of(birthday, next, generatedAt);
            publisher.publish(reminder);
            birthdays.markReminded(birthday.id(), next.date());
            log.info("Sent reminder {}", reminder.eventId());
            sent++;
        }

        log.info("Reminder run for {}: {} sent", today, sent);
    }
}
