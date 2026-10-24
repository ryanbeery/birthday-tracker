package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A row of the birthdays table, as the reminder job reads it.
 *
 * @param giftIdeas              null when there are none
 * @param lastRemindedOccurrence the birthday the last reminder was for, or null if none was sent
 */
record SavedBirthday(
        UUID id,
        String name,
        String email,
        LocalDate birthday,
        int reminderWindowDays,
        String giftIdeas,
        LocalDate lastRemindedOccurrence) {
}
