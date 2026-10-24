#!/usr/bin/env bash
# End-to-end check of the running Compose stack: a submission goes through the UI's
# origin to the API, the queue and the coordinator, comes back from both GETs, and its
# reminder reaches the birthday.reminders.email queue. Run it after `docker compose up`.
# It adds a "Smoke Test" entry each time; scripts/reset-db.sh clears them.
set -euo pipefail
cd "$(dirname "$0")/.."

# Compose's .env has the RabbitMQ credentials for the management API.
set -a
. ./.env
set +a

UI=http://localhost:5173
RABBITMQ=http://localhost:15672

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# request URL [curl options] sets $status and $body. curl -w appends the status code
# on its own last line.
request() {
  local response
  response=$(curl -sS -w '\n%{http_code}' "$@") || fail "no answer from $1. Is the stack up? Try docker compose ps."
  status=${response##*$'\n'}
  body=${response%$'\n'*}
}

# The UTC date N days from now as MM-DD, with GNU date (Linux, Git Bash) or BSD date (macOS).
month_day_in() {
  date -u -d "+$1 days" +%m-%d 2>/dev/null || date -u -v+"$1"d +%m-%d
}

request http://localhost:3000/health
[ "$status" = 200 ] || fail "API health returned $status"
request http://localhost:8080/actuator/health
[ "$status" = 200 ] || fail "coordinator health returned $status"
echo "ok   API and coordinator are healthy"

request "$UI/api/birthdays" -X POST -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test","email":"not-an-email","birthday":"2023-02-30","reminderWindowDays":15}'
[ "$status" = 400 ] || fail "an invalid submission returned $status, expected 400"
echo "ok   an invalid submission gets a 400"

# A birthday 3 days away with a 7-day window, so its reminder is due on the next run.
# 2000 is a leap year, so the date is valid even when it's Feb 29.
birthday="2000-$(month_day_in 3)"
request "$UI/api/birthdays" -X POST -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Test\",\"email\":\"smoke@example.com\",\"birthday\":\"$birthday\",\"reminderWindowDays\":7}"
[ "$status" = 202 ] || fail "a valid submission returned $status, expected 202: $body"
id=$(echo "$body" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
[ -n "$id" ] || fail "the 202 had no id: $body"
echo "ok   a valid submission gets a 202 with id $id"

# A 202 means accepted, not saved, so the detail is a 404 until the coordinator commits.
for _ in $(seq 1 15); do
  request "$UI/api/birthdays/$id"
  [ "$status" = 200 ] && break
  sleep 1
done
[ "$status" = 200 ] || fail "the detail GET still returned $status after 15 seconds"
echo "$body" | grep -q '"daysUntil":3' || fail "the detail doesn't say 3 days until the birthday: $body"
echo "ok   the coordinator saved it, and the detail GET returns it"

request "$UI/api/birthdays"
echo "$body" | grep -q "\"id\":\"$id\"" || fail "the list GET doesn't include $id"
echo "ok   the list GET includes it"

# Compose runs the reminder job every minute. Peek at the queue through the management
# API: ack_requeue_true puts every message back, so the queue keeps its reminders.
echo "...  waiting up to 75 seconds for the reminder job"
for _ in $(seq 1 15); do
  request "$RABBITMQ/api/queues/%2F/birthday.reminders.email/get" -X POST \
    -u "$RABBITMQ_USER:$RABBITMQ_PASSWORD" \
    -H 'Content-Type: application/json' \
    -d '{"count":1000,"ackmode":"ack_requeue_true","encoding":"auto"}'
  [ "$status" = 200 ] || fail "the RabbitMQ management API returned $status"
  echo "$body" | grep -q "$id" && break
  sleep 5
done
echo "$body" | grep -q "$id" || fail "no reminder for $id reached birthday.reminders.email"
echo "ok   its reminder reached birthday.reminders.email"

echo "PASS"
