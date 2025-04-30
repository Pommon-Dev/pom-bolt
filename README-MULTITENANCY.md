# Multi-tenancy Support for Pom Bolt

This document provides instructions for setting up and migrating Pom Bolt to support multi-tenancy across all environments.

## Overview

Multi-tenancy allows the application to serve multiple organizations (tenants) from a single deployment while keeping each tenant's data isolated. This implementation uses a `tenant_id` field in all database tables to segregate data.

## Features

- **Data Isolation**: Each tenant's data is stored with a unique `tenant_id` in database tables
- **Tenant-based Access Control**: API endpoints validate tenant access permissions
- **Environment-specific Settings**: Different tenant validation rules for local, preview, and production environments
- **Default Tenant Support**: Ability to assign default tenant IDs to existing records

## Setup Instructions

### Prerequisites

- Wrangler CLI (version 3.x or higher)
- Access to Cloudflare dashboard (for production/preview setup)
- Database access credentials configured in your Cloudflare Pages project

### Configuration Files

The multi-tenancy setup relies on the following files:

1. **schema-combined.sql**: Complete database schema with tenant_id fields
2. **schema-migration.sql**: Migration script for updating existing databases
3. **wrangler.toml**: Contains environment variables and database bindings

### Environment Variables

The following environment variables should be added to your Cloudflare Pages environment:

```
MULTI_TENANT_ENABLED=true
DEFAULT_TENANT_ID=default (or your organization's ID)
STRICT_TENANT_VALIDATION=true (for production), false (for preview/development)
```

These variables are already added to the `wrangler.toml` file.

## Migration Process

### For New Installations

For new installations, use the `setup-all-environments.sh` script:

```bash
# Set up all environments
./scripts/setup-all-environments.sh

# Set up only specific environments
./scripts/setup-all-environments.sh --skip-production
./scripts/setup-all-environments.sh --skip-preview
```

### For Existing Installations

If you already have data in your database, use the migration script:

```bash
# Migrate local environment 
./scripts/migrate-db-multitenancy.sh local

# Migrate preview environment
./scripts/migrate-db-multitenancy.sh preview

# Migrate production environment
./scripts/migrate-db-multitenancy.sh remote

# Specify a custom default tenant ID
./scripts/migrate-db-multitenancy.sh local my-org
```

The migration process:
1. Backs up existing data (local environment only)
2. Updates the table structures to include tenant_id fields
3. Creates necessary indexes for tenant-based queries
4. Sets default tenant IDs for existing records
5. Verifies the schema changes

## Database Schema

The multi-tenant schema includes:

- `tenant_id` field in all primary tables (projects, deployments, file_metadata, etc.)
- Indexes on tenant_id fields for efficient querying
- A `tenant_access_logs` table for auditing tenant access

## Best Practices

1. **Always include tenant ID validation** in API endpoints
2. Use the `validateTenantAccess` middleware for all project-related routes
3. Set appropriate tenant IDs when creating new records
4. Use tenant-specific KV prefixes for KV store access

## Testing Multi-tenancy

To verify that multi-tenancy is working correctly:

1. Create projects with different tenant IDs
2. Verify that projects from one tenant are not visible to other tenants
3. Test authorization boundaries by attempting cross-tenant access
4. Verify that tenant access logs are recording access attempts

## Troubleshooting

Common issues and their solutions:

- **Missing tenant_id in API responses**: Ensure that all database queries filter by tenant_id
- **Cross-tenant data access**: Check API endpoint authorization middleware
- **Database migration errors**: Check the migration logs in the backups directory and verify table schemas

## Support

For assistance with multi-tenancy setup or migrations, contact the Pom Bolt development team. 