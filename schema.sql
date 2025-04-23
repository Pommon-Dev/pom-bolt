-- Schema for project metadata
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  user_id TEXT
);

-- Schema for search indexing
CREATE TABLE IF NOT EXISTS search_index (
  project_id TEXT PRIMARY KEY,
  keywords TEXT,
  features TEXT,
  technologies TEXT,
  last_indexed INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Schema for deployment history
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSON,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Schema for file metadata
CREATE TABLE IF NOT EXISTS file_metadata (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_project_id ON file_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(path);

-- Create index on updated_at for faster sorting
CREATE INDEX IF NOT EXISTS idx_projects_updated 
ON projects(updated_at DESC);

-- Create index on created_at for chronological listing
CREATE INDEX IF NOT EXISTS idx_projects_created
ON projects(created_at DESC);

-- File Chunks Table (if not using KV for file storage)
CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Create compound index for faster file lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_project_path
ON file_chunks(project_id, file_path); 