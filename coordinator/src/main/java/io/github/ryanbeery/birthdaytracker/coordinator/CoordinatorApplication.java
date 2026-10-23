package io.github.ryanbeery.birthdaytracker.coordinator;

import java.time.Clock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class CoordinatorApplication {

    public static void main(String[] args) {
        SpringApplication.run(CoordinatorApplication.class, args);
    }

    // The clock ReminderCalculator reads today's date from. Tests pass a fixed one instead.
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
