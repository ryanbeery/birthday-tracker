package io.github.ryanbeery.birthdaytracker.coordinator;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.File;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.stream.Stream;

import org.junit.jupiter.api.Named;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The reminder rule in CLAUDE.md, on fixed dates. No Spring context and no containers. */
class ReminderCalculatorTest {

    // Only today() reads the clock. next() and isReminderDue() take today as a parameter,
    // so the tests below pass each case's date directly and never read this one.
    private final ReminderCalculator calculator =
            new ReminderCalculator(Clock.fixed(Instant.EPOCH, ZoneOffset.UTC));

    /** One entry of contracts/next-birthday-cases.json. */
    record SharedCase(
            String name,
            LocalDate today,
            LocalDate birthday,
            LocalDate nextBirthday,
            int daysUntil,
            int turningAge) {
    }

    // The API's upcoming.test.ts runs the same file, so the Java and TypeScript rules
    // can't drift apart. The path is relative to coordinator/.
    static Stream<Named<SharedCase>> sharedCases() {
        JsonMapper json = JsonMapper.builder().build();
        JsonNode cases = json.readTree(new File("../contracts/next-birthday-cases.json")).get("cases");
        return Stream.of(json.treeToValue(cases, SharedCase[].class))
                .map(c -> Named.of(c.name(), c));
    }

    @ParameterizedTest
    @MethodSource("sharedCases")
    void findsTheNextBirthdayAsTheApiDoes(SharedCase c) {
        NextBirthday expected = new NextBirthday(c.nextBirthday(), c.daysUntil(), c.turningAge());

        assertThat(calculator.next(c.birthday(), c.today())).as(c.name()).isEqualTo(expected);
    }

    // A reminder is due when the birthday is 1 to N days away (N is the window) and none
    // has been sent for that date yet. An empty "last reminded" means none ever was.
    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', textBlock = """
            # case                                        | today      | birthday   | window | last reminded | due
            the first day of a 7-day window               | 2026-12-03 | 1990-12-10 | 7      |               | true
            the day before a 7-day window opens           | 2026-12-02 | 1990-12-10 | 7      |               | false
            the only day of a 1-day window                | 2026-12-09 | 1990-12-10 | 1      |               | true
            the first day of a 14-day window              | 2026-11-26 | 1990-12-10 | 14     |               | true
            the day before a 14-day window opens          | 2026-11-25 | 1990-12-10 | 14     |               | false
            the birthday itself                           | 2026-12-10 | 1990-12-10 | 7      |               | false
            a missed run, 3 days after the window opened  | 2026-12-06 | 1990-12-10 | 7      |               | true
            already reminded for this birthday            | 2026-12-06 | 1990-12-10 | 7      | 2026-12-10    | false
            reminded only for last year's birthday        | 2026-12-06 | 1990-12-10 | 7      | 2025-12-10    | true
            a window that crosses the new year            | 2026-12-28 | 2000-01-03 | 7      |               | true
            a Feb 29 birthday, on Feb 28 in 2027          | 2027-02-21 | 2000-02-29 | 7      |               | true
            """)
    void decidesWhetherAReminderIsDue(
            String description,
            LocalDate today,
            LocalDate birthday,
            int windowDays,
            LocalDate lastRemindedOccurrence,
            boolean due) {
        NextBirthday next = calculator.next(birthday, today);

        assertThat(calculator.isReminderDue(next, windowDays, lastRemindedOccurrence))
                .as(description)
                .isEqualTo(due);
    }

    @Test
    void todayIsTheUtcDateWhateverZoneTheClockIsIn() {
        // 02:00 UTC on Oct 23 is still 22:00 on Oct 22 in New York.
        Clock newYork = Clock.fixed(Instant.parse("2026-10-23T02:00:00Z"), ZoneId.of("America/New_York"));

        assertThat(new ReminderCalculator(newYork).today()).isEqualTo(LocalDate.of(2026, 10, 23));
    }
}
