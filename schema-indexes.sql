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

-- Create compound index for faster file lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_chunks_project_path
ON file_chunks(project_id, file_path); 