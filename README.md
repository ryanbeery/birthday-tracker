# Birthday Tracker

A small system for tracking birthdays and sending reminders before each one. A Vue UI submits birthdays to a Node API, which validates them and publishes them to RabbitMQ. A Spring Boot coordinator saves them to PostgreSQL and, once a day, publishes a reminder message for each birthday whose reminder window has opened. Another team's service would turn those messages into emails.

> This README grows with the build. Sections marked _To come_ are filled in by later slices.

## Initial setup

You need Docker Desktop (with Compose v2) and Git. To run a service outside Docker, you also need Node 24 or JDK 21. Maven comes with the wrapper.

```sh
git clone https://github.com/ryanbeery/birthday-tracker.git
cd birthday-tracker
cp .env.example .env
docker compose up --build
```

The first build downloads the npm and Maven dependencies, so it takes a few minutes. Once `docker compose ps` shows every service as healthy, these are up:

| Service | Address |
|---|---|
| UI | http://localhost:5173 |
| API health | http://localhost:3000/health |
| Coordinator health | http://localhost:8080/actuator/health |
| RabbitMQ management UI | http://localhost:15672 (admin / pass) |
| PostgreSQL | localhost:5432 (credentials in `.env`) |

**Troubleshooting**

- *A port is already in use:* stop the program using it, or change the left-hand port for that service in `compose.yaml`.
- *Start over with an empty database:* `docker compose down -v` deletes the data volume, and `db/init.sql` recreates the schema on the next `up`.

## Day-to-day commands

_To come:_ unit tests for each app, `scripts/smoke.sh` for an end-to-end check, and `scripts/reset-db.sh` to clear test data.

## Development approach: test-driven

_To come:_ tests are written and approved before the code they cover. This was required for the reminder calculator, submission validation and the POST status contract, where a bug would fail silently.

## Architecture and message contracts

_To come:_ a diagram of the submit, read and remind flows, and the submission and reminder message formats.

## Why PostgreSQL and RabbitMQ

_To come:_ the reasoning for both, and how they map to AWS (SQS and SNS, with DynamoDB as a scaling option).

## Delivery semantics

_To come:_ at-least-once delivery, the idempotent `ON CONFLICT (id) DO NOTHING` insert and why it's safe, retries and the dead-letter queue, and the reminder `eventId` for downstream deduplication.

## Why no ORM

_To come:_ two services in two languages share one schema, so plain SQL with a single schema owner keeps the contract explicit.

## Assumptions

_To come:_ the product decisions the brief left open, such as the reminder rule and the Feb 29 rule.

## Production readiness

_To come:_ what's built and what's future work, such as auth, migrations, pagination and monitoring.

Edit and delete are future work. They would go through the queue as commands to the coordinator, since it's the only writer. Four cases need care:

- Edits can arrive out of order, for example when one is replayed from the dead-letter queue. A version number on each row and each edit makes a stale edit a no-op.
- An edit can arrive before its create, while the create is still retrying. It finds no row, so it retries too, and dead-letters if the row never appears.
- A delete can arrive before its create, so it leaves a tombstone that stops the late create from bringing the row back.
- An edit that changes the birthday or the reminder window resets `last_reminded_occurrence`.

This is also why the insert uses `ON CONFLICT DO NOTHING` rather than an upsert: a redelivered create must never overwrite a later edit.

Telling the UI the moment a submission is saved is also future work. The coordinator would publish a `birthday.saved` event after its commit, and the API would consume it and stream it to the browser over Server-Sent Events.

## How I used AI

_To come:_ how the plan was drafted, reviewed and built with coding agents, and what I accepted, rejected and verified myself.

## Decision log

One line per decision made during the build. Each started as options with a recommendation from the coding agent, and I made the call.

| Decision | Options | Choice and why |
|---|---|---|
| How the UI container serves the app | nginx serving the built app, or the Vite dev server | nginx. It's production-shaped, every `docker compose up --build` type-checks and bundles the UI, and the UI and API share one origin, so the API needs no CORS. |
| Node version | Node 24, or Node 22 as first planned | Node 24. Node 22 reaches end of life on April 30, 2027. |
| TypeScript version | 6.0 or 7.0 | 6.0. The ESLint TypeScript tooling doesn't support 7 yet. |
| How the UI finds a new entry after a 202 | One refetch after about a second, retries with backoff, or a push from the coordinator | One refetch, then a Refresh button. The write normally lands within milliseconds, and a push needs an event, a consumer and a streaming endpoint (see Production readiness). |

## Time spent and tests run

_To come._
