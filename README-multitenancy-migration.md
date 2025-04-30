# Multi-tenancy Migration Guide

This document provides instructions for migrating your existing Pom Bolt setup to support multi-tenancy. The migration includes updating database schemas, environment variables, and application code.

## Prerequisites

- Ensure you have the latest version of Pom Bolt codebase
- Install the latest version of wrangler CLI: `npm install -g wrangler@latest`
- Backup your data before proceeding

## Migration Steps

### 1. Update Database Schema

The migration involves adding `tenant_id` columns to all relevant tables in the D1 database. We've prepared a script that handles this automatically.

#### For Local Development

```bash
# Run the multi-tenancy setup script for local environment
chmod +x scripts/setup-d1-multitenancy.sh
./scripts/setup-d1-multitenancy.sh local
```

#### For Preview Environment

```bash
# Run the multi-tenancy setup script for preview environment
./scripts/setup-d1-multitenancy.sh preview
```

#### For Production Environment

```bash
# Run the multi-tenancy setup script for production environment
./scripts/setup-d1-multitenancy.sh remote
```

### 2. Configure Environment Variables

Add the following environment variables to your `.env.local` file for local development:

```
MULTI_TENANT_ENABLED=true
DEFAULT_TENANT_ID=default
STRICT_TENANT_VALIDATION=false
```

For Cloudflare Pages configuration, make sure these variables are set in your wrangler.toml file. The current configuration already includes these settings.

### 3. Update KV Store Usage

The migration doesn't require structural changes to KV stores, but application code should now prefix all keys with tenant IDs to maintain proper isolation. This is handled automatically by the updated codebase.

### 4. Verify Migration

After completing the migration, verify that:

1. All tables in the D1 database have a `tenant_id` column
2. Existing records have the default tenant ID
3. New records are created with the appropriate tenant ID
4. API endpoints properly validate tenant access

You can use the following commands to verify the schema changes:

```bash
# For local environment
npx wrangler d1 execute pom_bolt --local --command="PRAGMA table_info(projects);"
npx wrangler d1 execute pom_bolt --local --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_tenant%';"

# For preview/production, replace --local with --preview or remove for production
```

## Troubleshooting

If you encounter issues during migration:

1. Check the logs from the setup-d1-multitenancy.sh script
2. Verify that all environment variables are properly set
3. For local development, you can reset the database and start fresh by deleting the .wrangler/state/d1 directory and re-running setup scripts

## Migration Options

### Custom Default Tenant ID

If you want to specify a custom default tenant ID for existing records:

```bash
# Replace 'my_org' with your desired tenant ID
./scripts/setup-d1-multitenancy.sh local my_org
```

### Environment-Specific Tenant IDs

You can set different default tenant IDs for different environments:

- Local: Usually 'default' or your development organization ID
- Preview: Often 'preview' or a test organization ID
- Production: Typically your main organization ID

## Next Steps

After successful migration:

1. Update your application code to include tenant IDs in all database and KV store operations
2. Implement proper tenant validation in API endpoints
3. Test cross-tenant scenarios to ensure proper isolation
4. Deploy the updated application to Cloudflare Pages 