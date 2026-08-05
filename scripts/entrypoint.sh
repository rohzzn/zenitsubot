#!/bin/sh
set -e

echo "Applying database migrations..."

# `migrate deploy` is the correct path and never discards data. The db push
# fallback exists only for a database that predates the migration history;
# it is reported loudly because it can alter the schema in place.
if ! npx prisma migrate deploy; then
  echo "WARNING: migrate deploy failed, falling back to db push" >&2
  npx prisma db push --skip-generate
fi

echo "Starting bot..."

# exec so node becomes PID 1 and receives SIGTERM directly. Without this the
# shell swallows the signal and Docker escalates to SIGKILL (exit 137).
exec node dist/index.js
