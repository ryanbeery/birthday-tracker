# CLAUDE.md

Rules and context for coding agents working in this repo. The design reasoning lives in README.md. This file holds what an agent needs to do the work.

## The project

Birthday Tracker is a take-home assessment for Automox. A Vue UI submits birthdays to a Node API, which validates them and publishes them to RabbitMQ. A Spring Boot coordinator consumes the messages, writes them to PostgreSQL, and once a day publishes reminder messages for another team's email service (not built here). The API reads the same database to serve the UI.

```
Submit:  frontend -> api (validates) -> RabbitMQ birthday.submissions -> coordinator -> PostgreSQL
Read:    frontend -> api -> PostgreSQL
Remind:  coordinator (daily, UTC) -> PostgreSQL -> RabbitMQ birthday.reminders -> email service (not built)
```

| Path | Role | Stack |
|---|---|---|
| `frontend/` | UI | Vue 3, Vite, TypeScript, `<script setup>`, fetch, local state. No router, store or component library. |
| `api/` | REST API and publisher. Tests in `api/test/`. | Node 24, Express, TypeScript, Zod, `pg`, amqplib |
| `coordinator/` | Consumer, only writer, scheduler: `SubmissionListener`, `BirthdayRepository`, `ReminderCalculator`, `ReminderJob`, `ReminderPublisher` | Java 21, Spring Boot, Maven wrapper, Spring AMQP, JdbcClient, Actuator |
| `db/init.sql` | The only schema definition | PostgreSQL |
| `contracts/submission-queue.json` | The submissions queue declaration both services must match, checked by a test on each side | JSON |
| `compose.yaml` | Runs everything locally, with health checks and a Postgres volume | Docker Compose |

## Design rules

- The coordinator is the only writer. The API only reads the database.
- No ORM. Plain SQL, with `db/init.sql` as the single schema owner.
- Delivery is at least once. The listener is `@Transactional` and acks only after commit.
- The insert is `INSERT ... ON CONFLICT (id) DO NOTHING`. Ids are per-submission UUIDs from the API, so a conflict can only be a redelivery of a saved message. Keep a code comment on that insert in `BirthdayRepository` saying so, and log "duplicate delivery ignored" when 0 rows are inserted.
- The listener retries 3 times with backoff, then dead-letters to `birthday.submissions.dlq` (`default-requeue-rejected=false`).
- The API publishes through a small publisher interface, so tests can mock it and SQS could replace RabbitMQ.
- Age is never stored. `turningAge` (occurrence year minus birth year) is computed on read.
- Time is UTC everywhere, and dates travel as `YYYY-MM-DD` strings. In Node, parse dates strictly (JS `Date` turns `2023-02-30` into March 2), and give `pg` a DATE type parser so dates come back as strings. In Java, use `LocalDate`.
- User text is plain text everywhere. The UI shows it only through Vue's escaped bindings, never with `v-html` or in an `href`, and the reminder contract tells consumers to escape it.

## Contracts

Changing anything in this section needs Ryan's approval first (see "Stop and ask").

**`birthdays` table:** `id` uuid PK, from the API · `name` text, trimmed, 1–100 chars, no control characters · `email` text, the reminder recipient · `birthday` date, year 1900 or later, not in the future · `reminder_window_days` smallint, CHECK 1–14 · `gift_ideas` text, nullable, trimmed, up to 500 chars, no control characters except tabs and line breaks, null when blank · `last_reminded_occurrence` date, nullable · `created_at` timestamptz, default `now()`

**HTTP:** JSON in and out, no auth. Errors are `{ "error": "...", "details": [...] }`.

| Route | Result |
|---|---|
| `POST /api/birthdays` | 202 `{ id }` once the broker confirms. 400 on validation errors (unknown fields included) or malformed JSON, 413 if the body is over 100 KB, 503 if publishing fails or isn't confirmed within 5 seconds, and a generic 500 if RabbitMQ refuses the API's credentials or queue arguments, since a retry can't help. Invalid input is never published. A 202 means accepted, not saved. |
| `GET /api/birthdays` | List sorted by next upcoming birthday, with days until it and `turningAge`. 503 if the database is unavailable. |
| `GET /api/birthdays/:id` | One entry. 404 if it doesn't exist (expected briefly while the message is in flight), 400 if the id isn't a UUID, 503 if the database is unavailable. |
| `GET /health` | API liveness. The coordinator's is `/actuator/health`. |

Unknown routes return 404, and anything unexpected returns 500, both in the error shape. Error responses never include stack traces or SQL; those go to the logs.

**Submission message** (queue `birthday.submissions`): `{ id, name, email, birthday, reminderWindowDays, giftIdeas?, submittedAt }`. `giftIdeas` is left out when blank. Messages are persistent JSON with content type `application/json`. The API and the coordinator both declare the queue exactly as `contracts/submission-queue.json` describes: durable, and dead-lettering to `birthday.submissions.dlq`. That file is the only written copy of the arguments, and a test on each side checks its declaration against it, so change the file and both declarations together. The API declares the queue because RabbitMQ confirms and then drops a message sent to a queue that doesn't exist yet. If the two declarations differ, RabbitMQ rejects the second one at startup.

**Reminder message** (exchange `birthday.reminders`): `{ eventId, type: "birthday.reminder", birthdayId, name, email, birthday, occurrenceDate, turningAge, giftIdeas?, reminderWindowDays, generatedAt }`. `eventId` is derived from `birthdayId` and `occurrenceDate`, so consumers can dedupe. `name` and `giftIdeas` are plain text, which consumers must escape for their output, such as HTML email.

**Reminder rule:** the occurrence is the next birthday on or after today, and Feb 29 falls on Feb 28 in non-leap years. A daily run sends when `occurrence - N <= today < occurrence` and `last_reminded_occurrence != occurrence`, then sets `last_reminded_occurrence = occurrence`. The birthday itself never triggers a send. The cron is `${reminders.cron}` in UTC, every minute in the local profile. `ReminderCalculator` is pure logic with an injected `Clock`. One coordinator instance is assumed.

**UI:** a form (name, email, birthday, reminder window 1–14, optional gift ideas) with inline validation. The list loads on landing and shows "turning N in X days", with an optional client-side name filter. Clicking a row opens a detail panel. A failed load shows the error and a Retry button. After a 202, show "Submitted, processing", open the new id's detail, refetch once after about a second, and offer a Refresh button. No polling.

## Slices

Build in this order, and build nothing outside this list. Correctness comes first and the code stays concise. Anything worth doing later goes in the README's future work, not the build.

| # | Deliverable | Ryan's gate |
|---|---|---|
| 0 | Scaffold, Compose with Postgres and RabbitMQ, `init.sql`, CLAUDE.md, CI, README outline | `docker compose up` shows every service healthy |
| 1 | Submission schema and POST route | Test cases, then test code, approved before the code; then diff review |
| 2 | Queue -> coordinator -> DB | A submitted row reaches the DB, and a manual redelivery leaves one row |
| 3 | List and detail GETs (error cases tested with the database mocked), Vue form, list and detail | Click-through in a browser |
| 4 | `ReminderCalculator` | Test cases, then test code, approved before the code; then line-by-line review |
| 5 | Scheduler, reminder publish, demo cron | A reminder is visible in the RabbitMQ UI |
| 6 | `scripts/smoke.sh`, `scripts/reset-db.sh`, README completion | A fresh clone runs on the README alone |

## How we work

### Test-driven development

TDD is required where a bug would fail silently:

- `ReminderCalculator` (JUnit, fixed dates): both window edges, the day before the window opens, Dec -> Jan rollover, Feb 29 in a non-leap year, an already-reminded occurrence, and `turningAge` (including a Feb 29 birthday).
- The Zod submission schema, including strict dates (`2023-02-30` is rejected).
- `POST /api/birthdays` (Vitest and supertest, publisher mocked): 202, 400 (including malformed JSON) and 503, and invalid input never publishes.
- `SubmissionListener` (JUnit against real PostgreSQL and RabbitMQ via Testcontainers): a redelivery leaves one row, a brief error is retried, rejected and malformed messages are dead-lettered, and unknown fields are ignored.

Each one goes through three gates, in order:

1. Propose the test cases as plain sentences. Ryan approves or edits the list, and may write the `ReminderCalculator` list personally.
2. Write only the test code, and hand it over as its own commit. Ryan approves it.
3. Write the implementation until the tests pass, as the next commit.

Never write an implementation and its tests in the same step. Wiring code (Compose, Spring config, Vue layout, SELECT queries) is covered by the smoke test instead.

### Stop and ask

Before adding a dependency, changing a contract above, or making any choice this file doesn't cover, stop and give Ryan two options with a recommendation. Ryan decides, and each decision gets one line in the README's decision log: the options, the choice and why.

### Commits and review

- Ryan commits and pushes. Agents never commit or push.
- Hand work over as a commit plan. For each commit, list its files and a three-line brief: what changed, where to look first, and what you're unsure of. Ryan writes every commit message.
- Aim for about 100 changed lines of reviewed logic per commit. Generated code (scaffolding, lockfiles, template Dockerfiles) gets its own commit and is checked by running it.
- Each file belongs to one commit per handoff, so Ryan can stage by file. If a later commit has to change the same file, hand over in two parts.
- Ryan reads every line of `ReminderCalculator`, the submission schema, the POST handler, the listener insert and the reminder job, so keep each small and in its own commit. Vue and SELECT code gets skimmed and run. Scaffolding gets run.
- CI (GitHub Actions) runs lint, type checks and both unit-test suites on every push to main and every pull request. The only expected red run is between a TDD test commit and its implementation.

## Environment

- Ryan works on Windows in IntelliJ IDEA Ultimate, and everything runs in Linux containers. `.gitattributes` keeps line endings LF. Git on Windows doesn't record the executable bit, so new scripts are staged with `git add --chmod=+x`, and Dockerfiles and CI call `sh mvnw` to be safe.
- `.idea/`, `.env`, `node_modules/`, `dist/` and `target/` stay out of git. Config comes from environment variables, and `.env.example` lists them all.
- Ports: UI 5173, API 3000, coordinator 8080, RabbitMQ 5672 with its UI on 15672 (admin/pass), Postgres 5432.

## Commands

```
cp .env.example .env && docker compose up --build   # the whole stack
cd api && npm ci && npm run lint && npm run type-check && npm test
cd frontend && npm ci && npm run lint && npm run type-check && npm run build
cd coordinator && ./mvnw verify                      # mvnw.cmd verify on Windows. Needs Docker running.
```
