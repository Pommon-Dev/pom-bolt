#!/bin/bash

# setup-d1-multitenancy.sh
# This script updates existing D1 databases with multi-tenancy support
# It ensures all tables have tenant_id columns and appropriate indexes
# Usage: ./scripts/setup-d1-multitenancy.sh [local|preview|production] [default_tenant_id]

set -e

# Determine environment based on first argument
ENVIRONMENT=${1:-local}
DEFAULT_TENANT_ID=${2:-default}
DATABASE_NAME="pommon"

# Display help if requested
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
  echo "Usage: ./scripts/setup-d1-multitenancy.sh [local|preview|production] [default_tenant_id]"
  echo ""
  echo "Arguments:"
  echo "  environment        The environment to update (local, preview, or production). Default: local"
  echo "  default_tenant_id  The default tenant ID to assign to existing records. Default: default"
  echo ""
  echo "Examples:"
  echo "  ./scripts/setup-d1-multitenancy.sh local"
  echo "  ./scripts/setup-d1-multitenancy.sh preview tenant123"
  echo "  ./scripts/setup-d1-multitenancy.sh production org_main"
  exit 0
fi

echo "🚀 Setting up multi-tenancy for D1 database in $ENVIRONMENT environment"
echo "Using default tenant ID: $DEFAULT_TENANT_ID"

# Function to run D1 commands based on environment
run_d1_command() {
  local command=$1
  local args=$2

  if [ "$ENVIRONMENT" == "local" ]; then
    echo "Running local D1 command: $command"
    npx wrangler d1 $command $DATABASE_NAME $args
  else
    echo "Running remote D1 command for $ENVIRONMENT: $command"
    npx wrangler d1 $command $DATABASE_NAME --env $ENVIRONMENT $args
  fi
}

# Step 1: Backup current schema (local only)
if [ "$ENVIRONMENT" == "local" ]; then
  echo "📦 Backing up current schema..."
  mkdir -p ./.backup
  TIMESTAMP=$(date +%Y%m%d%H%M%S)
  BACKUP_FILE="./.backup/d1_schema_backup_$TIMESTAMP.sql"
  
  npx wrangler d1 execute $DATABASE_NAME --command ".schema" --json > $BACKUP_FILE
  echo "✅ Schema backed up to $BACKUP_FILE"
else
  echo "⚠️ Skipping backup for remote environment. Please ensure you have backed up your data."
fi

# Step 2: Apply multi-tenancy schema updates
echo "🔄 Applying multi-tenancy schema updates..."
run_d1_command "execute" "--file=./schema-multitenancy.sql"

# Step 3: Verify schema changes
echo "🔍 Verifying schema changes..."
run_d1_command "execute" "--command=\"PRAGMA table_info(projects); PRAGMA table_info(deployments);\""

# Step 4: Verify indexes
echo "🔍 Verifying indexes..."
run_d1_command "execute" "--command=\"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_tenant%';\""

# Step 5: Update existing records with default tenant ID (if specified and not 'default')
if [ "$DEFAULT_TENANT_ID" != "default" ]; then
  echo "📝 Setting tenant_id=$DEFAULT_TENANT_ID for all existing records..."
  
  TABLES=("projects" "deployments" "search_index" "file_metadata" "file_chunks" "chat_sessions" "chat_messages")
  
  for table in "${TABLES[@]}"; do
    echo "Updating $table table..."
    run_d1_command "execute" "--command=\"UPDATE $table SET tenant_id = '$DEFAULT_TENANT_ID' WHERE tenant_id = 'default';\""
  done
  
  echo "✅ All existing records updated with tenant_id=$DEFAULT_TENANT_ID"
else
  echo "ℹ️ Using 'default' as tenant ID for existing records. No updates needed."
fi

echo "✅ Multi-tenancy setup complete for $ENVIRONMENT environment!"
echo "Next steps:"
echo "1. Update your environment variables to enable multi-tenancy"
echo "2. Ensure your code validates tenant access properly"
echo "3. Test your application with multiple tenants" 