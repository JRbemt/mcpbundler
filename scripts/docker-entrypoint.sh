#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy --schema=./prisma/postgres/schema.prisma

echo "Starting application..."
exec node dist/src/main.js