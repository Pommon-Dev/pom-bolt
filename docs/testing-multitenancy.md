# Testing Multi-tenancy in Pom Bolt

This guide outlines a series of tests to verify that multi-tenancy is functioning correctly in your Pom Bolt deployment. These tests should be performed after migrating or setting up multi-tenancy.

## Prerequisites

- A working deployment of Pom Bolt with multi-tenancy enabled
- Access to at least two different tenant accounts
- API testing tools (such as Postman, curl, or the Pom Bolt UI)
- Database access for verification (optional)

## Test Cases

### 1. Project Isolation

**Objective**: Verify that projects are properly isolated between tenants.

**Steps**:
1. Create a project for Tenant A (`tenant_id = "tenant-a"`)
2. Create a project for Tenant B (`tenant_id = "tenant-b"`)
3. As Tenant A, fetch the list of projects
4. As Tenant B, fetch the list of projects

**Expected Results**:
- Tenant A should only see their own project(s)
- Tenant B should only see their own project(s)
- Neither tenant should see the other's projects

**API Endpoints**:
```
POST /api/projects
GET /api/projects
```

### 2. Cross-Tenant Access Prevention

**Objective**: Verify that tenants cannot access other tenants' resources.

**Steps**:
1. Create a project for Tenant A and note its ID
2. As Tenant B, attempt to access Tenant A's project using its ID

**Expected Results**:
- Access attempt should be denied with a 403 Forbidden status
- The response should indicate an authorization error
- The access attempt should be logged in the tenant_access_logs table

**API Endpoints**:
```
GET /api/projects/{project_id}
PUT /api/projects/{project_id}
DELETE /api/projects/{project_id}
```

### 3. Deployment Isolation

**Objective**: Verify that deployments are isolated per tenant.

**Steps**:
1. Create a project and deployment for Tenant A
2. Create a project and deployment for Tenant B
3. As Tenant A, fetch deployments
4. As Tenant B, fetch deployments

**Expected Results**:
- Each tenant should only see their own deployments
- Deployment IDs should be tenant-specific

**API Endpoints**:
```
POST /api/deploy
GET /api/projects/{project_id}/deployments
```

### 4. File Storage Isolation

**Objective**: Verify that project files are isolated between tenants.

**Steps**:
1. Upload files to a project belonging to Tenant A
2. Upload files to a project belonging to Tenant B
3. As Tenant A, attempt to access files from Tenant B's project
4. As Tenant B, attempt to access files from Tenant A's project

**Expected Results**:
- Each tenant should only be able to access their own files
- Cross-tenant file access attempts should be denied

**API Endpoints**:
```
POST /api/projects/{project_id}/files
GET /api/projects/{project_id}/files
GET /api/projects/{project_id}/files/{file_path}
```

### 5. Search Isolation

**Objective**: Verify that search results are filtered by tenant.

**Steps**:
1. Create projects with similar content for both Tenant A and Tenant B
2. Perform the same search query as Tenant A and Tenant B

**Expected Results**:
- Tenant A should only receive results from their own projects
- Tenant B should only receive results from their own projects

**API Endpoints**:
```
GET /api/search?q={query}
```

### 6. Database Verification

**Objective**: Verify that tenant_id is properly set in the database.

**Steps**:
1. After performing the above tests, check the database tables

**Expected Results**:
- All rows in the projects, deployments, file_metadata, and search_index tables should have a valid tenant_id
- tenant_access_logs should record access attempts, especially failed cross-tenant access

**SQL Queries**:
```sql
-- Check tenant_id in projects
SELECT id, name, tenant_id FROM projects;

-- Check tenant_id in deployments
SELECT id, project_id, tenant_id FROM deployments;

-- Check tenant access logs for unauthorized access
SELECT * FROM tenant_access_logs WHERE success = 0;
```

### 7. KV Store Prefixing

**Objective**: Verify that KV keys are properly prefixed with tenant IDs.

**Steps**:
1. Store project files for Tenant A
2. Store project files for Tenant B
3. List all keys in the KV store

**Expected Results**:
- KV keys should be prefixed with the appropriate tenant ID
- The format should follow `{tenant_id}:{project_id}:{file_path}`

### 8. Default Tenant Fallback

**Objective**: Verify that the default tenant setting works correctly.

**Steps**:
1. Set a default tenant in the environment variables
2. Make API requests without explicitly specifying a tenant ID

**Expected Results**:
- The system should use the default tenant ID
- Resources should be created with the default tenant ID

## Testing in Different Environments

### Local Testing

Run these tests in your local environment first with `STRICT_TENANT_VALIDATION=false` to debug any issues.

```bash
# Set up local environment
./scripts/migrate-db-multitenancy.sh local

# Run application
npm run dev
```

### Preview Testing

Test in the Preview environment with a mix of strict and lenient validation.

```bash
# Deploy to preview
npm run deploy:preview

# Test with preview URLs
```

### Production Testing

Production should always have `STRICT_TENANT_VALIDATION=true`.

```bash
# Deploy to production
npm run deploy:production

# Test with production URLs
```

## Troubleshooting

- **403 Forbidden for all requests**: Check that tenant IDs are being passed in requests
- **Missing tenant_id in responses**: Verify SQL queries include tenant filtering
- **Cross-tenant access possible**: Check middleware validation logic
- **KV access issues**: Verify KV key prefixing in the code

## Reporting Issues

If you discover any issues with multi-tenancy implementation, please report them with:

1. The specific test case that failed
2. Environment details (local, preview, production)
3. Any error messages or unexpected behavior
4. Steps to reproduce the issue 