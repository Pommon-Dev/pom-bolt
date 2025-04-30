#!/bin/bash

# setup-all-environments.sh - Comprehensive setup script for all environments
# This script sets up databases for local, preview, and production environments

set -e  # Exit immediately if a command exits with a non-zero status

# Display banner
echo "==============================================="
echo "Pom Bolt - Multi-tenant Environment Setup Tool"
echo "==============================================="
echo "This script will set up all environments with the latest schema"
echo "and multi-tenancy support."
echo

# Check if parameters were provided
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "Usage: $0 [--skip-local] [--skip-preview] [--skip-production]"
  echo "  --skip-local       - Skip local environment setup"
  echo "  --skip-preview     - Skip preview environment setup"
  echo "  --skip-production  - Skip production environment setup"
  echo "  --default-tenant   - Default tenant ID to use for existing records (default: 'default')"
  echo
  echo "Example: $0 --skip-production --default-tenant my-org"
  exit 0
fi

# Parse parameters
SKIP_LOCAL=false
SKIP_PREVIEW=false
SKIP_PRODUCTION=false
DEFAULT_TENANT="default"

for arg in "$@"; do
  case $arg in
    --skip-local)
      SKIP_LOCAL=true
      shift
      ;;
    --skip-preview)
      SKIP_PREVIEW=true
      shift
      ;;
    --skip-production)
      SKIP_PRODUCTION=true
      shift
      ;;
    --default-tenant=*)
      DEFAULT_TENANT="${arg#*=}"
      shift
      ;;
  esac
done

echo "Configuration:"
echo "- Skip local: $SKIP_LOCAL"
echo "- Skip preview: $SKIP_PREVIEW"
echo "- Skip production: $SKIP_PRODUCTION"
echo "- Default tenant: $DEFAULT_TENANT"
echo

# Function to run setup
run_environment_setup() {
  local env=$1
  
  echo "Setting up $env environment..."
  
  # Get database info for this environment
  DB_NAME="pom-bolt-db"
  if [ "$env" = "preview" ]; then
    # Extract the preview database ID from wrangler.toml
    PREVIEW_DB_ID=$(grep -A 3 "env.preview.d1_databases" wrangler.toml | grep "database_id" | awk -F '"' '{print $2}')
    if [ -n "$PREVIEW_DB_ID" ]; then
      DB_NAME="$PREVIEW_DB_ID"
      echo "Using preview database ID: $DB_NAME"
    fi
  fi
  
  # Create or update schema with the normal schema script
  if [ "$env" = "local" ]; then
    ./scripts/setup-d1-local.sh
  elif [ "$env" = "preview" ]; then
    ./scripts/setup-d1-remote.sh preview
  elif [ "$env" = "production" ]; then
    ./scripts/setup-d1-remote.sh
  fi
  
  # Set default tenant for existing records if specified
  if [ -n "$DEFAULT_TENANT" ]; then
    echo "Setting default tenant ID for any NULL tenant_id records: $DEFAULT_TENANT"
    
    if [ "$env" = "local" ]; then
      npx wrangler d1 execute $DB_NAME --local --command="UPDATE projects SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --local --command="UPDATE deployments SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --local --command="UPDATE file_metadata SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --local --command="UPDATE search_index SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
    elif [ "$env" = "preview" ]; then
      TENANT="preview"
      npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE projects SET tenant_id = '$TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE deployments SET tenant_id = '$TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE file_metadata SET tenant_id = '$TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --env=preview --command="UPDATE search_index SET tenant_id = '$TENANT' WHERE tenant_id IS NULL;"
    else
      npx wrangler d1 execute $DB_NAME --remote --command="UPDATE projects SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --command="UPDATE deployments SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --command="UPDATE file_metadata SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
      npx wrangler d1 execute $DB_NAME --remote --command="UPDATE search_index SET tenant_id = '$DEFAULT_TENANT' WHERE tenant_id IS NULL;"
    fi
  fi
  
  echo "Environment $env setup complete!"
  echo
}

# Setup each environment unless skipped
if [ "$SKIP_LOCAL" = false ]; then
  run_environment_setup "local"
fi

if [ "$SKIP_PREVIEW" = false ]; then
  run_environment_setup "preview"
fi

if [ "$SKIP_PRODUCTION" = false ]; then
  run_environment_setup "production"
fi

echo "==============================================="
echo "All requested environments have been set up successfully!"
echo "You can now use the application with multi-tenancy support."
echo "==============================================="

exit 0 