package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.LocalDate;

/**
 * When a birthday next comes around, from {@link ReminderCalculator#next}.
 *
 * @param date       the next birthday on or after today (the reminder message's occurrenceDate)
 * @param daysUntil  0 when the birthday is today; as high as 366 during leap years
 * @param turningAge the age the person turns on that date
 */
record NextBirthday(LocalDate date, int daysUntil, int turningAge) {
}
