#!/bin/bash

# Script to migrate existing D1 databases to support multi-tenancy
# This script handles schema changes carefully without data loss

set -e  # Exit immediately if a command exits with a non-zero status

echo "=== Migrating D1 database to multi-tenancy schema ==="

# Determine environment from arguments
ENVIRONMENT="local"
if [ "$1" = "remote" ] || [ "$1" = "production" ]; then
  ENVIRONMENT="production"
elif [ "$1" = "preview" ]; then
  ENVIRONMENT="preview"
fi

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "Usage: $0 [local|remote|preview] [default_tenant_id]"
  echo "  local   - Migrates local D1 database (default)"
  echo "  remote  - Migrates production D1 database"
  echo "  preview - Migrates preview D1 database"
  echo
  echo "  default_tenant_id - The default tenant ID to use for existing records (default: 'default')"
  exit 0
fi

# Get the default tenant ID from the second argument or use "default"
DEFAULT_TENANT=${2:-"default"}
if [ "$ENVIRONMENT" = "preview" ] && [ "$2" = "" ]; then
  DEFAULT_TENANT="preview"
fi

echo "Environment: $ENVIRONMENT"
echo "Default tenant ID: $DEFAULT_TENANT"

# Get database name from wrangler.toml
DB_NAME="pom-bolt-db"

# Backup the database first (local only)
if [ "$ENVIRONMENT" = "local" ]; then
  echo "Step 1: Creating backup of current database..."
  timestamp=$(date +%Y%m%d%H%M%S)
  mkdir -p ./backups
  npx wrangler d1 execute $DB_NAME --local --command="SELECT name FROM sqlite_master WHERE type='table';" > "./backups/tables_${timestamp}.txt"
  
  for table in projects deployments search_index file_metadata file_chunks; do
    echo "Backing up table: $table"
    npx wrangler d1 execute $DB_NAME --local --command="SELECT * FROM $table;" > "./backups/${table}_${timestamp}.txt"
  done
  
  echo "Backup complete. Backup files stored in ./backups/ directory."
else
  echo "Step 1: Skipping backup for remote environments."
fi

# Apply the migration script
echo "Step 2: Applying migration script..."
if [ "$ENVIRONMENT" = "local" ]; then
  npx wrangler d1 execute $DB_NAME --local --file=./schema-multitenancy.sql
elif [ "$ENVIRONMENT" = "preview" ]; then
  npx wrangler d1 execute $DB_NAME --remote --env=preview --file=./schema-multitenancy.sql
else
  npx wrangler d1 execute $DB_NAME --remote --file=./schema-multitenancy.sql
fi

if [ $? -ne 0 ]; then
  echo "Error applying migration. Exiting."
  exit 1
fi

# Set default tenant ID for all records that have NULL tenant_id
echo "Step 3: Setting default tenant ID ($DEFAULT_TENANT) for existing records..."
if [ "$ENVIRONMENT" = "local" ]; then
  npx wrangler d1 execute $DB_NAME --local --command="UPDATE projects SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --local --command="UPDATE deployments SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --local --command="UPDATE file_metadata SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --local --command="UPDATE search_index SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
elif [ "$ENVIRONMENT" = "preview" ]; then
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE projects SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE deployments SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE file_metadata SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE search_index SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
else
  npx wrangler d1 execute $DB_NAME --remote --command="UPDATE projects SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --command="UPDATE deployments SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --command="UPDATE file_metadata SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
  npx wrangler d1 execute $DB_NAME --remote --command="UPDATE search_index SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
fi

# Verify schema changes
echo "Step 4: Verifying schema updates..."
if [ "$ENVIRONMENT" = "local" ]; then
  npx wrangler d1 execute $DB_NAME --local --command="PRAGMA table_info(projects);"
  npx wrangler d1 execute $DB_NAME --local --command="PRAGMA table_info(file_metadata);"
  npx wrangler d1 execute $DB_NAME --local --command="PRAGMA table_info(file_chunks);"
  npx wrangler d1 execute $DB_NAME --local --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%tenant%';"
elif [ "$ENVIRONMENT" = "preview" ]; then
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="PRAGMA table_info(projects);"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="PRAGMA table_info(file_metadata);"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="PRAGMA table_info(file_chunks);"
  npx wrangler d1 execute $DB_NAME --remote --env=preview --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%tenant%';"
else
  npx wrangler d1 execute $DB_NAME --remote --command="PRAGMA table_info(projects);"
  npx wrangler d1 execute $DB_NAME --remote --command="PRAGMA table_info(file_metadata);"
  npx wrangler d1 execute $DB_NAME --remote --command="PRAGMA table_info(file_chunks);"
  npx wrangler d1 execute $DB_NAME --remote --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%tenant%';"
fi

echo "=== Database migration to multi-tenancy completed successfully ==="
echo "The database now supports proper multi-tenancy with tenant_id field."

exit 0 