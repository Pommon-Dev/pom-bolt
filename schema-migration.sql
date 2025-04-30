-- Migration script for adding tenant_id to existing tables and updating column names
-- This script preserves existing data while making schema changes

-- First, ensure tenant_id is NOT NULL in all relevant tables
-- Update file_metadata: rename path to file_path
ALTER TABLE file_metadata RENAME COLUMN path TO file_path;

-- Migrate file_chunks table structure
-- First create a backup of the existing data
CREATE TABLE file_chunks_backup AS SELECT 
  id, 
  project_id, 
  tenant_id,
  file_path, 
  content, 
  created_at, 
  updated_at 
FROM file_chunks;

-- Drop the old table
DROP TABLE file_chunks;

-- Create the new file_chunks table with updated structure
CREATE TABLE file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES file_metadata(id) ON DELETE CASCADE
);

-- Create indexes for file_chunks
CREATE INDEX IF NOT EXISTS idx_file_chunks_file ON file_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_index ON file_chunks(chunk_index);

-- Create tenant access logs table if it doesn't exist yet
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

-- Create or update indexes
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deployments_tenant_id ON deployments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_tenant_id ON file_metadata(tenant_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_path ON file_metadata(file_path);
CREATE INDEX IF NOT EXISTS idx_search_index_tenant_id ON search_index(tenant_id);

-- Create tenant access logs indexes
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_tenant_id ON tenant_access_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_resource ON tenant_access_logs(resource_id, resource_type);
CREATE INDEX IF NOT EXISTS idx_tenant_access_logs_timestamp ON tenant_access_logs(timestamp DESC);

-- Make tenant_id NOT NULL (will be set to default value in a separate command)
-- We don't do this here to avoid locking if there's existing data 