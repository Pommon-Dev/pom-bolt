-- Basic indexes for projects table
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);

-- Compound indexes for enhanced tenant-based queries
CREATE INDEX IF NOT EXISTS idx_projects_tenant_user ON projects(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_updated ON projects(tenant_id, updated_at DESC);

-- Indexes for deployments table
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_provider ON deployments(provider);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_status ON deployments(tenant_id, status);

-- Indexes for file metadata table
CREATE INDEX IF NOT EXISTS idx_file_metadata_project_id ON file_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata(tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_project ON file_metadata(tenant_id, project_id);

-- Indexes for search index table
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_index_last_indexed ON search_index(last_indexed);

-- Indexes for tenant access logs
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_resource ON tenant_access_logs(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_timestamp ON tenant_access_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_success ON tenant_access_logs(success);

-- Compound index for file chunks table
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_project_path ON file_chunks(project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_file_chunks_tenant_id ON file_chunks(tenant_id); 