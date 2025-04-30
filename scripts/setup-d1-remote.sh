#!/bin/bash

# Setup D1 database in remote environment step by step

# Check for environment argument
ENVIRONMENT=""
DB_NAME="pom-bolt-db"

if [ "$1" = "preview" ]; then
  ENVIRONMENT="--env=preview"
  echo "Setting up D1 database for Cloudflare preview environment..."
  # Extract the preview database ID from wrangler.toml
  PREVIEW_DB_ID=$(grep -A 3 "env.preview.d1_databases" wrangler.toml | grep "database_id" | awk -F '"' '{print $2}')
  if [ -n "$PREVIEW_DB_ID" ]; then
    echo "Using preview database ID: $PREVIEW_DB_ID"
    DB_NAME="$PREVIEW_DB_ID"
  fi
else
  echo "Setting up D1 database for Cloudflare production environment..."
fi

# Create all tables and indexes
echo "Step 1: Creating tables and indexes..."
if [ "$1" = "preview" ]; then
  # For preview, use the specific database ID
  npx wrangler d1 execute $DB_NAME --remote $ENVIRONMENT --file=./schema-combined.sql
else
  # For production, use the database name
  npx wrangler d1 execute $DB_NAME --remote $ENVIRONMENT --file=./schema-combined.sql
fi

if [ $? -ne 0 ]; then
  echo "Error creating tables. Aborting setup."
  exit 1
fi

# Check if tables were created correctly
echo "Step 2: Verifying database setup..."
npx wrangler d1 execute $DB_NAME --remote $ENVIRONMENT --command="SELECT name FROM sqlite_master WHERE type='table';"
echo "Checking indexes..."
npx wrangler d1 execute $DB_NAME --remote $ENVIRONMENT --command="SELECT name FROM sqlite_master WHERE type='index';"

echo "D1 database setup complete!" 