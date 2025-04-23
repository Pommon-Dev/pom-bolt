#!/bin/bash

# Script to initialize the requirements database
# This script initializes the database for the requirements system
# It sets up the "requirements" project and project list entries

echo "Setting up requirements database..."

# Ensure we're in the project root
cd "$(dirname "$0")/.."

# Default to local mode
MODE="local"

# Process flags
if [ "$1" == "--remote" ]; then
  MODE="remote"
  echo "Running in REMOTE mode - will update production database"
else
  echo "Running in LOCAL mode - will update local development database"
  echo "(Use --remote flag to update production database)"
fi

# Run the database initialization script
echo "Running requirements database initialization..."

if [ "$MODE" == "remote" ]; then
  # Remote mode
  echo "Initializing REMOTE database..."
  node scripts/fix-requirements-db.js --remote
else
  # Local mode
  echo "Initializing LOCAL database..."
  node scripts/fix-requirements-db.js
fi

# Check if initialization was successful
if [ $? -eq 0 ]; then
  echo "✅ Requirements database initialization completed successfully."
else
  echo "❌ Requirements database initialization failed."
  exit 1
fi

# Test API endpoint
echo "Testing requirements API endpoint..."

if [ "$MODE" == "remote" ]; then
  # Remote mode
  echo "Testing REMOTE API endpoint..."
  ENDPOINT="https://pom-bolt.pages.dev/api/requirements"
else
  # Local mode
  echo "Testing LOCAL API endpoint..."
  ENDPOINT="http://localhost:5173/api/requirements"
fi

# Create a simple requirements entry
echo "Creating a test requirement..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "requirements",
    "requirements": [{
      "id": "test-req-'$(date +%s)'",
      "content": "Test requirement created by setup script",
      "timestamp": '$(date +%s000)',
      "status": "pending"
    }]
  }'

# Check the result
if [ $? -eq 0 ]; then
  echo "✅ Requirements API test was successful."
else
  echo "❌ Requirements API test failed."
  exit 1
fi

echo ""
echo "🎉 Requirements setup completed successfully."
echo "You can now use the /api/requirements endpoint." 