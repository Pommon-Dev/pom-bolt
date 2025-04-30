-- Since we've already created the tables with tenant_id, let's focus on creating indexes and
-- the tenant_access_logs table which doesn't exist yet

-- Add tenant_id index for faster tenant-based queries if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);

-- Add tenant_id index for deployments if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);

-- Add tenant_id index for search if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);

-- Create tenant access logs table if it doesn't exist
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

-- Add tenant_id index for file metadata if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata(tenant_id);

-- Create indexes for tenant access logs
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_resource ON tenant_access_logs(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_timestamp ON tenant_access_logs(timestamp DESC);

-- Add tenant_id to projects table if not exists
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default' NOT NULL;

-- Add tenant_id to deployments table if not exists
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default' NOT NULL;

-- Add tenant_id to search_index table if not exists
ALTER TABLE search_index ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default' NOT NULL;

-- Add tenant_id to file_metadata table if not exists
ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default' NOT NULL;

-- Add tenant_id to file_chunks table if not exists
ALTER TABLE file_chunks ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default' NOT NULL;

-- Create an index on projects for tenant_id and project_id combination
CREATE INDEX IF NOT EXISTS idx_projects_tenant_project ON projects (tenant_id, project_id);

-- Create an index on deployments for tenant_id and project_id combination
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_project ON deployments (tenant_id, project_id);

-- Create an index on search_index for tenant_id column
CREATE INDEX IF NOT EXISTS idx_search_index_tenant ON search_index (tenant_id);

-- Create an index on file_metadata for tenant_id and project_id combination
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_project ON file_metadata (tenant_id, project_id);

-- Create an index on file_chunks for tenant_id and file_id combination
CREATE INDEX IF NOT EXISTS idx_file_chunks_tenant_file ON file_chunks (tenant_id, file_id);

-- Verify database schema has been updated with tenant_id fields
PRAGMA table_info(projects);
PRAGMA table_info(deployments);
PRAGMA table_info(search_index);
PRAGMA table_info(file_metadata);
PRAGMA table_info(file_chunks);

-- Validation query to check indexes related to tenant_id
SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_tenant%';

-- Multi-tenancy Schema Update

-- Add tenant_id to projects table
ALTER TABLE projects ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects (tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_project ON projects (tenant_id, id);

-- Add tenant_id to deployments table
ALTER TABLE deployments ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_project ON deployments (tenant_id, project_id);

-- Add tenant_id to search_index table
ALTER TABLE search_index ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index (tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_project ON search_index (tenant_id, project_id);

-- Add tenant_id to file_metadata table
ALTER TABLE file_metadata ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata (tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_project ON file_metadata (tenant_id, project_id);

-- Add tenant_id to file_chunks table if it exists
ALTER TABLE file_chunks ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_file_chunks_tenant_id ON file_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_tenant_project ON file_chunks (tenant_id, project_id);

-- Add tenant_id to chat_sessions table if it exists
ALTER TABLE chat_sessions ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_id ON chat_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant_project ON chat_sessions (tenant_id, project_id);

-- Add tenant_id to chat_messages table if it exists
ALTER TABLE chat_messages ADD COLUMN tenant_id TEXT DEFAULT 'default' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant_id ON chat_messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant_session ON chat_messages (tenant_id, session_id);

-- Verify that all tables have the tenant_id column
PRAGMA table_info(projects);
PRAGMA table_info(deployments);
PRAGMA table_info(search_index);
PRAGMA table_info(file_metadata);
PRAGMA table_info(file_chunks);
PRAGMA table_info(chat_sessions);
PRAGMA table_info(chat_messages);

-- Verify that all tenant-related indexes have been created
SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%_tenant%'; 