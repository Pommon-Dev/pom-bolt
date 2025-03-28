#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"  # Change to your preferred region
REPOSITORY="pom-bolt"
IMAGE_NAME="bolt-ai"
SERVICE_NAME="pom-bolt"
TAG=${1:-"latest"}

# Full image name for Artifact Registry
REGISTRY_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"

# Check if the image exists in Artifact Registry
if ! gcloud artifacts docker images describe "${REGISTRY_IMAGE}" --quiet &>/dev/null; then
  echo "Image ${REGISTRY_IMAGE} not found in Artifact Registry."
  echo "Run './scripts/push-to-artifact-registry.sh' first."
  exit 1
fi

echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image="${REGISTRY_IMAGE}" \
  --platform=managed \
  --region="${REGION}" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --port=8080 \
  --set-env-vars="RUNNING_IN_CLOUD_RUN=true,NODE_ENV=production" \
  --set-secrets="ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,BETA_ACCESS_CODES=BETA_ACCESS_CODES:latest"

# Get the URL of the deployed service
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" --platform=managed --region="${REGION}" --format='value(status.url)')

echo "Service deployed successfully!"
echo "Service URL: ${SERVICE_URL}" 