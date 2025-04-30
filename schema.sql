-- Schema for project metadata
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tenant_id TEXT DEFAULT 'default' NOT NULL,
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  display_order INTEGER,
  user_id TEXT,
  config_json TEXT
);

-- Schema for search indexing
CREATE TABLE IF NOT EXISTS search_index (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default' NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Schema for deployment history
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default' NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  error TEXT,
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  config_json TEXT,
  result_json TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Schema for file metadata
CREATE TABLE IF NOT EXISTS file_metadata (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default' NOT NULL,
  file_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  content_type TEXT,
  metadata_json TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_project_id ON file_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata(tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_project_tenant ON file_metadata(project_id, tenant_id);

-- Create index on updated_at for faster sorting
CREATE INDEX IF NOT EXISTS idx_projects_updated 
ON projects(updated_at DESC);

-- Create index on created_at for chronological listing
CREATE INDEX IF NOT EXISTS idx_projects_created
ON projects(created_at DESC);

-- Create index on tenant_id for filtering
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);

-- File Chunks Table (if not using KV for file storage)
CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_data BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES file_metadata(id) ON DELETE CASCADE
);

-- Create compound index for faster file lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_index ON file_chunks(chunk_index);

-- Create tenant access logs table
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
  timestamp INTEGER NOT NULL,
  details_json TEXT
);

-- Create indices for tenant access logs
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_resource ON tenant_access_logs(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_timestamp ON tenant_access_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_user ON tenant_access_logs(user_id);

-- Create index on search_index project_id
CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);

-- Create index on search_index file_path
CREATE INDEX IF NOT EXISTS idx_search_path ON search_index(file_path);

-- Create index on search_index tenant_id
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);
CREATE INDEX IF NOT EXISTS idx_search_index_project_tenant ON search_index(project_id, tenant_id);

-- Create index on deployments project_id
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);

-- Create index on deployments status
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);

-- Create index on deployments tenant_id
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_tenant ON deployments(project_id, tenant_id);

-- Create index on search_index project_id
CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);

-- Create index on search_index file_path
CREATE INDEX IF NOT EXISTS idx_search_path ON search_index(file_path);

-- Create index on search_index tenant_id
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);

-- Create index on deployments project_id
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);

-- Create index on deployments status
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);

-- Create index on deployments tenant_id
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);

-- Create index on search_index project_id
CREATE INDEX IF NOT EXISTS idx_search_project ON search_index(project_id);

-- Create index on search_index file_path
CREATE INDEX IF NOT EXISTS idx_search_path ON search_index(file_path);

-- Create index on search_index tenant_id
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);

-- Create index on deployments project_id
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);

-- Create index on deployments status
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);

-- Create index on deployments tenant_id
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id); 