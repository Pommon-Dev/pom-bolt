INSERT INTO projects (id, name, createdAt, updatedAt, files, requirements, deployments, currentDeploymentId, metadata)
VALUES (
  'test-id',
  'Test Project',
  strftime('%s','now'),
  strftime('%s','now'),
  '[]',
  '[]',
  '[]',
  NULL,
  '{}'
);
