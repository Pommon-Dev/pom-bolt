-- Combined schema file for Pom Bolt that includes base schema and multi-tenancy support
-- This file can be used to set up a new database from scratch with multi-tenancy

-- Projects table with tenant_id
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tenant_id TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  display_order INTEGER,
  user_id TEXT
);

-- Search index table with tenant_id
CREATE TABLE IF NOT EXISTS search_index (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Deployments table with tenant_id
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  error TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- File metadata table with tenant_id
CREATE TABLE IF NOT EXISTS file_metadata (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- File chunks table
CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES file_metadata(id) ON DELETE CASCADE
);

-- Tenant access logs table
CREATE TABLE IF NOT EXISTS tenant_access_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  timestamp INTEGER NOT NULL
);

-- Create indexes for performance

-- Project indexes
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- Search indexes
CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);
CREATE INDEX IF NOT EXISTS idx_search_path ON search_index(file_path);
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);

-- Deployment indexes
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at DESC);

-- File metadata indexes
CREATE INDEX IF NOT EXISTS idx_file_metadata_project ON file_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata(tenant_id);

-- File chunks indexes
CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_index ON file_chunks(chunk_index);

-- Tenant access logs indexes
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_resource ON tenant_access_logs(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_timestamp ON tenant_access_logs(timestamp DESC); 