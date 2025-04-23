#!/bin/bash

# Setup D1 database in local environment step by step

echo "Setting up D1 database for local development environment..."

# First, create the tables
echo "Step 1: Creating tables..."
npx wrangler d1 execute pom_bolt_metadata --local --file=./schema-tables.sql
if [ $? -ne 0 ]; then
  echo "Error creating tables. Aborting setup."
  exit 1
fi

# After tables are created, add indexes
echo "Step 2: Creating indexes..."
npx wrangler d1 execute pom_bolt_metadata --local --file=./schema-indexes.sql
if [ $? -ne 0 ]; then
  echo "Warning: Error creating some indexes. Database may not be fully optimized."
fi

# Check if tables were created correctly
echo "Step 3: Verifying database setup..."
npx wrangler d1 execute pom_bolt_metadata --local --command="SELECT name FROM sqlite_master WHERE type='table';"

echo "D1 database setup complete!" 