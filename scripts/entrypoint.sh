#!/bin/sh
set -e
echo "Running database migrations..."
npx prisma migrate deploy || npx prisma db push
echo "Starting bot..."
node dist/index.js


