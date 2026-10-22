package io.github.ryanbeery.birthdaytracker.coordinator;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Writes to the birthdays table. The coordinator is its only writer. */
@Repository
class BirthdayRepository {

    private final JdbcClient jdbc;

    BirthdayRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Saves a submission. Returns false, and changes nothing, if its id is already saved. */
    boolean insert(SubmissionMessage submission) {
        // Only a redelivery can conflict here. The API gives each submission a new random
        // UUID, so an id arrives twice only when RabbitMQ delivers a saved message again,
        // for example because the coordinator stopped after the commit but before the ack.
        // DO NOTHING makes that second copy a no-op instead of a primary key error.
        int inserted = jdbc.sql("""
                        INSERT INTO birthdays (id, name, email, birthday, reminder_window_days, gift_ideas)
                        VALUES (:id, :name, :email, :birthday, :reminderWindowDays, :giftIdeas)
                        ON CONFLICT (id) DO NOTHING
                        """)
                .param("id", submission.id())
                .param("name", submission.name())
                .param("email", submission.email())
                .param("birthday", submission.birthday())
                .param("reminderWindowDays", submission.reminderWindowDays())
                .param("giftIdeas", submission.giftIdeas())
                .update();
        return inserted == 1;
    }
}
