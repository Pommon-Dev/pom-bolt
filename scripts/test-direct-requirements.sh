#!/bin/bash

# Test script for the simplified direct requirements API endpoint

# Define endpoint URL
ENDPOINT="http://localhost:8788/api/requirements-direct"

echo "Testing direct requirements API..."

# Generate a test project ID
PROJECT_ID=$(uuidgen)
echo "Using project ID: $PROJECT_ID"

# Create a new requirements project
echo -e "\nCreating a new requirements project..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"requirements\": [
      {
        \"id\": \"req1\",
        \"content\": \"First requirement\",
        \"timestamp\": $(date +%s000)
      },
      {
        \"id\": \"req2\",
        \"content\": \"Second requirement\",
        \"timestamp\": $(date +%s000)
      }
    ]
  }"

# Sleep to allow the server to process
sleep 1

# Get the created project
echo -e "\n\nFetching the project we just created..."
curl -X GET "$ENDPOINT?projectId=$PROJECT_ID"

# Update the project with additional requirements
echo -e "\n\nUpdating the project with additional requirements..."
curl -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"requirements\": [
      {
        \"id\": \"req1\",
        \"content\": \"First requirement (updated)\",
        \"timestamp\": $(date +%s000)
      },
      {
        \"id\": \"req2\",
        \"content\": \"Second requirement\",
        \"timestamp\": $(date +%s000)
      },
      {
        \"id\": \"req3\",
        \"content\": \"Third requirement (new)\",
        \"timestamp\": $(date +%s000)
      }
    ]
  }"

# Sleep to allow the server to process
sleep 1

# Get the updated project
echo -e "\n\nFetching the updated project..."
curl -X GET "$ENDPOINT?projectId=$PROJECT_ID"

echo -e "\n\nTest completed!" 