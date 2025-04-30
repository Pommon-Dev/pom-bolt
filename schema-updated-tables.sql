-- Schema for project metadata with multi-tenancy support
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  user_id TEXT
);

-- Schema for search indexing with multi-tenancy
CREATE TABLE IF NOT EXISTS search_index (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  keywords TEXT,
  features TEXT,
  technologies TEXT,
  last_indexed INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Schema for deployment history with multi-tenancy
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSON,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Schema for file metadata with multi-tenancy
CREATE TABLE IF NOT EXISTS file_metadata (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Schema for tenant access tracking
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

-- File Chunks Table with multi-tenancy (if not using KV for file storage)
CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tenant_id TEXT,
  file_path TEXT NOT NULL,
  content TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
); 