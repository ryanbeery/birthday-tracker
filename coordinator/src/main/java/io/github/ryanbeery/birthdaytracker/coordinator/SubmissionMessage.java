package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A submission from the birthday.submissions queue, as the API publishes it (the contract is
 * in CLAUDE.md). The message also carries submittedAt, which the coordinator doesn't read:
 * the row's created_at comes from the database.
 *
 * @param giftIdeas null when the submission had none
 */
record SubmissionMessage(
        UUID id,
        String name,
        String email,
        LocalDate birthday,
        int reminderWindowDays,
        String giftIdeas) {
}
