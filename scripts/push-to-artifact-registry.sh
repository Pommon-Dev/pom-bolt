#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"  # Change to your preferred region
REPOSITORY="pom-bolt"
IMAGE_NAME="bolt-ai"
TAG=${1:-"latest"}

# Check if the registry repository exists, if not create it
if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${REGION}" &>/dev/null; then
  echo "Creating Artifact Registry repository: ${REPOSITORY} in ${REGION}..."
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Docker repository for Pom Bolt"
fi

# Full image name for Artifact Registry
REGISTRY_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"

echo "Building Docker image for Cloud Run..."
docker build -t "${IMAGE_NAME}:cloudrun" --target bolt-ai-cloudrun .

echo "Tagging Docker image for Artifact Registry..."
docker tag "${IMAGE_NAME}:cloudrun" "${REGISTRY_IMAGE}"

echo "Pushing to Artifact Registry..."
docker push "${REGISTRY_IMAGE}"

echo "Image successfully pushed to: ${REGISTRY_IMAGE}" 