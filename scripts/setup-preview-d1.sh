#!/bin/bash

# Script to specifically set up the preview D1 database 
# This uses the --env=preview flag to target the preview database

set -e  # Exit immediately if a command exits with a non-zero status

echo "=== Setting up Preview D1 database ==="

# Use the database name with the preview environment flag
DB_NAME="pom-bolt-db"

echo "Using database: $DB_NAME with --env=preview flag"

# Create all tables and indexes
echo "Step 1: Creating tables and indexes..."
npx wrangler d1 execute $DB_NAME --remote --env=preview --file=./schema-combined.sql

if [ $? -ne 0 ]; then
  echo "Error creating tables. Aborting setup."
  exit 1
fi

# Verify the database setup
echo "Step 2: Verifying database setup..."
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="SELECT name FROM sqlite_master WHERE type='table';"

echo "Step 3: Checking indexes..."
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="SELECT name FROM sqlite_master WHERE type='index';"

# Set default tenant ID for all records
echo "Step 4: Setting default tenant ID (preview) for all NULL records..."
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE projects SET tenant_id = 'preview' WHERE tenant_id IS NULL;"
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE deployments SET tenant_id = 'preview' WHERE tenant_id IS NULL;"
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE file_metadata SET tenant_id = 'preview' WHERE tenant_id IS NULL;"
npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE search_index SET tenant_id = 'preview' WHERE tenant_id IS NULL;"

echo "=== Preview D1 database setup complete ==="
echo "The preview database now supports multi-tenancy with tenant_id fields."
exit 0 