package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A reminder for the email service, published to the birthday.reminders exchange (the
 * contract is in CLAUDE.md). The email service must escape name and giftIdeas for its output.
 *
 * @param eventId   the same for every copy of a reminder, so the email service can drop repeats
 * @param giftIdeas left out of the JSON when there are none
 */
record ReminderMessage(
        String eventId,
        String type,
        UUID birthdayId,
        String name,
        String email,
        LocalDate birthday,
        LocalDate occurrenceDate,
        int turningAge,
        @JsonInclude(JsonInclude.Include.NON_NULL) String giftIdeas,
        int reminderWindowDays,
        Instant generatedAt) {

    static ReminderMessage of(SavedBirthday birthday, NextBirthday next, Instant generatedAt) {
        return new ReminderMessage(
                // The birthday's id and the occurrence date, such as
                // 5b0e5a3c-1f6e-4a52-9a3b-2f1d6c7e8a90:2026-12-10.
                birthday.id() + ":" + next.date(),
                "birthday.reminder",
                birthday.id(),
                birthday.name(),
                birthday.email(),
                birthday.birthday(),
                next.date(),
                next.turningAge(),
                birthday.giftIdeas(),
                birthday.reminderWindowDays(),
                generatedAt);
    }
}
