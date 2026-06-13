#!/bin/sh
set -e

echo "Waiting for database to be ready..."
until npx prisma db push --accept-data-loss; do
  echo "Database is not ready yet. Retrying in 2 seconds..."
  sleep 2
done

echo "Seeding database..."
npx prisma db seed

echo "Database setup complete."
