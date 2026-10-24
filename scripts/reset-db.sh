#!/usr/bin/env sh
# Deletes every birthday and keeps the schema, for a clean demo or test run. It needs the
# Compose stack running. Reminders already published stay on their RabbitMQ queue.
# To also reset RabbitMQ and recreate the schema, run `docker compose down -v` instead.
set -eu
cd "$(dirname "$0")/.."

# psql runs inside the postgres container, which already has the credentials.
docker compose exec -T postgres sh -c \
  'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "TRUNCATE birthdays"'

echo "Deleted every birthday."
