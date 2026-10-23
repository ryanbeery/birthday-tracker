package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

import org.springframework.stereotype.Component;

/**
 * The reminder rule in CLAUDE.md, as plain date logic. Only {@link #today()} reads the clock,
 * so a daily run reads it once and judges every birthday by the same date, even if the run
 * crosses midnight.
 */
@Component
class ReminderCalculator {

    private final Clock clock;

    ReminderCalculator(Clock clock) {
        this.clock = clock;
    }

    /** Today's date in UTC, whatever zone the clock is in. */
    LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);
    }

    /**
     * The next birthday on or after today. A Feb 29 birthday falls on Feb 28 in non-leap years.
     * The API's upcoming.ts applies the same rule, and both pass contracts/next-birthday-cases.json.
     */
    NextBirthday next(LocalDate birthday, LocalDate today) {
        // withYear turns Feb 29 into Feb 28 when the year has no Feb 29.
        LocalDate nextBirthday = birthday.withYear(today.getYear());
        if (nextBirthday.isBefore(today)) {
            nextBirthday = birthday.withYear(today.getYear() + 1);
        }

        // At most 366 days away, so the cast to int is safe.
        int daysUntil = (int) ChronoUnit.DAYS.between(today, nextBirthday);
        int turningAge = nextBirthday.getYear() - birthday.getYear();
        return new NextBirthday(nextBirthday, daysUntil, turningAge);
    }

    /**
     * Whether today's run should send a reminder: the birthday is 1 to windowDays days away,
     * and no reminder has gone out for it yet. The birthday itself never triggers one.
     *
     * @param lastRemindedOccurrence the birthday the last reminder was for, or null if none was sent
     */
    boolean isReminderDue(NextBirthday next, int windowDays, LocalDate lastRemindedOccurrence) {
        boolean insideWindow = next.daysUntil() >= 1 && next.daysUntil() <= windowDays;
        boolean alreadyReminded = next.date().equals(lastRemindedOccurrence);
        return insideWindow && !alreadyReminded;
    }
}
