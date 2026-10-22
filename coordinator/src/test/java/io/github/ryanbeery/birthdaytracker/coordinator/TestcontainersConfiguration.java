package io.github.ryanbeery.birthdaytracker.coordinator;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.MountableFile;

/**
 * Starts PostgreSQL and RabbitMQ in throwaway containers, on the same images as
 * compose.yaml. {@code @ServiceConnection} points the app's datasource and broker
 * connection at them.
 */
@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        // Postgres runs db/init.sql on first start, as it does in Compose, so the
        // tests use the real schema. The path is relative to coordinator/.
        return new PostgreSQLContainer("postgres:18-alpine")
                .withCopyFileToContainer(
                        MountableFile.forHostPath("../db/init.sql"),
                        "/docker-entrypoint-initdb.d/init.sql");
    }

    @Bean
    @ServiceConnection
    RabbitMQContainer rabbitmq() {
        return new RabbitMQContainer("rabbitmq:4-management-alpine");
    }
}
