#!/bin/bash

# Setup D1 database in local environment step by step

echo "Setting up D1 database for local development environment..."

# Get the database name from wrangler.toml (default to pom-bolt-db if not found)
DB_NAME="pom-bolt-db"

# Create all tables and indexes
echo "Step 1: Creating tables and indexes..."
npx wrangler d1 execute $DB_NAME --local --file=./schema-combined.sql
if [ $? -ne 0 ]; then
  echo "Error creating tables. Aborting setup."
  exit 1
fi

# Check if tables were created correctly
echo "Step 2: Verifying database setup..."
npx wrangler d1 execute $DB_NAME --local --command="SELECT name FROM sqlite_master WHERE type='table';"
echo "Checking indexes..."
npx wrangler d1 execute $DB_NAME --local --command="SELECT name FROM sqlite_master WHERE type='index';"

echo "D1 database setup complete!" 