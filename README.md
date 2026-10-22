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

_To come:_ tests are written and approved before the code they cover. This was required for the reminder calculator, submission validation, the POST status contract and the queue listener, where a bug would fail silently.

## Architecture and message contracts

_To come:_ a diagram of the submit, read and remind flows, and the submission and reminder message formats.

## Why PostgreSQL and RabbitMQ

_To come:_ the reasoning for both, and how they map to AWS (SQS and SNS, with DynamoDB as a scaling option).

## Delivery semantics

Submissions are delivered at least once, and the insert is idempotent, so a submission is never saved twice.

- **The coordinator acks only after saving.** The API answers 202 only once RabbitMQ confirms the message, which is persistent on a durable queue. The coordinator saves it in a transaction and acks it only after the commit. If the coordinator stops in between, RabbitMQ delivers the message again.
- **A second copy changes nothing.** Redelivery means the same message can arrive twice, so the insert is `INSERT ... ON CONFLICT (id) DO NOTHING`. The API gives each submission a new random UUID, so a conflict can only be a second copy of a saved message. The coordinator logs it as a duplicate delivery and acks it, and the table keeps one row.
- **Failures retry, then dead-letter.** If saving fails, the listener retries 3 times, 1, 2 and 4 seconds apart. A message that still fails is rejected without requeue, and RabbitMQ moves it to `birthday.submissions.dlq`, where it can be inspected or published again. Requeueing it instead would redeliver a message that can never succeed in an endless loop.
- **Unknown fields are ignored.** The coordinator reads only the contract's fields, so the API can add a field before the coordinator reads it.

_To come:_ the reminder `eventId` for downstream deduplication.

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

A 503 from the POST doesn't prove the submission was lost. If the broker saves the message but its confirm misses the API's 5-second limit, or the connection drops before the confirm arrives, the API returns 503, and a client that retries creates a second entry. Idempotency keys would close this gap: the client sends an `Idempotency-Key` header and reuses it on retries, the API derives the entry's id from the key, and the coordinator's `ON CONFLICT DO NOTHING` drops the repeat. They aren't built because a key reused with a different body would be dropped silently. Catching that needs a store of keys and request hashes, which the read-only API would have to write.

If the database is down for more than about two minutes, submissions that arrive during the outage end up in the dead-letter queue. Each of the 4 attempts waits up to 30 seconds for a database connection, on top of the 7 seconds of backoff. The messages are kept, but replaying them is a manual publish from the RabbitMQ UI. Production would alert on the dead-letter queue's depth, add a replay command, and pause the listener while the database is down instead of spending its retries.

Errors that can never succeed, such as malformed JSON or a value the table rejects, are retried like brief ones, so they reach the dead-letter queue 7 seconds later than they need to. The listener handles one message at a time, so the messages behind them wait too. Classifying those errors as fatal would skip the retries.

In production, one owner would declare the queues, such as infrastructure code or a RabbitMQ definitions file loaded at startup, and the services would only use them. Here both services declare the submissions queue (see the decision log), and `contracts/submission-queue.json` keeps the two declarations the same.

The UI and the API share the submission contract by convention. A shared package (npm workspaces) or an OpenAPI-generated client would let the compiler check the UI's requests against the API's schema.

Cross-site scripting is handled where text is displayed: Vue escapes everything it renders, and the reminder contract tells the email service to escape `name` and `giftIdeas`. A Content-Security-Policy header from nginx would be a backstop if escaping were ever bypassed.

Dates use UTC everywhere, which is simple but not right for every user. East of UTC, a newborn's birthday entered on the day of birth is rejected as "in the future" for up to 14 hours, and reminders follow the UTC date, not the user's. The production fix is a per-user time zone: the browser sends its IANA zone (such as `Australia/Sydney`), the API checks "not after today" in that zone, the zone is stored with the birthday, and the reminder job works out each person's today in their own zone.

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
| Unknown fields in a submission | Reject with a 400, or drop them silently | Reject. The API accepts exactly the documented fields, so a client can't choose its own id, and a misspelled optional field fails loudly instead of losing its value. |
| Blank gift ideas | Trim them and leave them out when blank, or store what was sent | Trim and leave out, so an empty text box doesn't store `""` or put an empty gift line in every reminder. |
| Who declares the submissions queue | The API and the coordinator, with identical arguments, or only the coordinator, with the API publishing as mandatory | Both. RabbitMQ confirms and then drops a message sent to a queue that doesn't exist yet, so the API declares the queue before its first publish and can take submissions while the coordinator is down. Mismatched arguments fail loudly at startup. |
| Idempotency keys on POST | Build them now, or leave them as future work | Future work. The basic version is small, but a key reused with a different body would be dropped silently, and catching that needs a key store the read-only API can't write (see Production readiness). |
| Control characters in text fields | Reject control characters and broken Unicode in names and gift ideas, or reject only NUL | Reject both. Postgres can't store NUL, so the API would accept it and the coordinator would dead-letter it, and a line break or escape code in a name is never real. Gift ideas keep tabs and line breaks. |
| Where the 5-second publish limit lives | In the POST route, or inside the RabbitMQ publisher | The route. A blocked broker (for example, under a memory alarm) neither confirms nor fails, so without a limit a POST hangs. In the route, the limit also covers a connection that hangs, and a test can check it with a fake clock. |
| How the coordinator's tests reach PostgreSQL and RabbitMQ | Testcontainers (real ones in throwaway containers), or no new dependencies (a unit test of the JSON mapping, with the rest checked by hand) | Testcontainers. A redelivery that adds a second row, or a dead-lettered message that's dropped, would fail silently, so those paths get automated tests against the real database and broker. The cost is three test-only dependencies, and `mvnw verify` needs Docker. |
| Unknown fields in a queued submission | Ignore them, or dead-letter the message | Ignore them. Only the API publishes to this queue, and it already rejects unknown fields from clients. Ignoring them lets the API ship a new optional field before the coordinator is redeployed, instead of dead-lettering every submission in between. The insert names its columns, so an extra field can't reach the table. I raised this case while reviewing the tests. |
| Personal data in the coordinator's failure logs | Leave Postgres's row values out of errors, or keep the full errors | Leave them out (`logServerErrorDetail=false`). A Postgres error includes the whole failing row, so every dead-lettered submission would log a name and an email. The log still names the constraint that failed, and the dead-letter queue keeps the full message. |
| How the two queue declarations stay in sync | The written contract in CLAUDE.md alone, or a shared `contracts/submission-queue.json` that a test on each side checks | The shared file. The services are in two languages and can't share code, so with only the written contract, a change on one side would go unnoticed until the other side failed with a 406 at startup. Now drift fails CI. I raised this while reviewing Slice 2. |

## Time spent and tests run

_To come._
