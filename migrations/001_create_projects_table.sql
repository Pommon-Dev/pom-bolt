-- migrations/001_create_projects_table.sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  files TEXT, -- JSON stringified array
  requirements TEXT, -- JSON stringified array
  deployments TEXT, -- JSON stringified array
  currentDeploymentId TEXT,
  metadata TEXT -- JSON stringified object
);
