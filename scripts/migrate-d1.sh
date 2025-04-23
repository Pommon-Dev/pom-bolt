#!/bin/bash
set -euo pipefail

# Usage: DB_NAME=your-d1-db-name ./scripts/migrate-d1.sh

# Check for wrangler
if ! command -v wrangler &> /dev/null; then
  echo "❌ wrangler CLI not found. Install it: https://developers.cloudflare.com/workers/wrangler/install/"
  exit 1
fi

# Check for DB_NAME env var
if [ -z "${DB_NAME:-}" ]; then
  echo "❌ Please set the DB_NAME environment variable to your D1 database name."
  echo "   Example: DB_NAME=mydb ./scripts/migrate-d1.sh"
  exit 1
fi

# Check for migrations directory
if [ ! -d "migrations" ]; then
  echo "❌ migrations directory not found. Please create a 'migrations/' directory with your .sql files."
  exit 1
fi

echo "🚀 Running D1 migrations for database: $DB_NAME"
for file in migrations/*.sql; do
  echo "➡️  Applying migration: $file"
  wrangler d1 execute "$DB_NAME" --file="$file"
done

echo "✅ All migrations applied successfully."
