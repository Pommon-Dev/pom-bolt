# Deploying to Google Cloud Run

This guide explains how to deploy the application to Google Cloud Run.

## Prerequisites

1. **Google Cloud Account**: You need a Google Cloud account with billing enabled.
2. **Google Cloud CLI**: Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install).
3. **Docker**: Install [Docker](https://docs.docker.com/get-docker/) on your local machine.
4. **API Keys**: Obtain API keys for Anthropic, OpenAI, and any other LLM providers you want to use.

## Setup Google Cloud Project

1. **Initialize Google Cloud CLI**:
   ```bash
   gcloud init
   ```

2. **Set your project**:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

3. **Enable required APIs**:
   ```bash
   gcloud services enable artifactregistry.googleapis.com run.googleapis.com
   ```

4. **Create Secrets**:
   ```bash
   echo -n "your-anthropic-api-key" | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
   echo -n "your-openai-api-key" | gcloud secrets create OPENAI_API_KEY --data-file=-
   echo -n "your-beta-access-codes" | gcloud secrets create BETA_ACCESS_CODES --data-file=-
   ```

5. **Grant Secret Access**:
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"
   
   gcloud secrets add-iam-policy-binding ANTHROPIC_API_KEY \
     --member="serviceAccount:${SERVICE_ACCOUNT}" \
     --role="roles/secretmanager.secretAccessor"
     
   gcloud secrets add-iam-policy-binding OPENAI_API_KEY \
     --member="serviceAccount:${SERVICE_ACCOUNT}" \
     --role="roles/secretmanager.secretAccessor"
     
   gcloud secrets add-iam-policy-binding BETA_ACCESS_CODES \
     --member="serviceAccount:${SERVICE_ACCOUNT}" \
     --role="roles/secretmanager.secretAccessor"
   ```

## Local Deployment

1. **Build the Docker Image**:
   ```bash
   pnpm run cloudrun:build
   ```

2. **Test Locally**:
   ```bash
   pnpm run cloudrun:local
   ```

3. **Push to Artifact Registry**:
   ```bash
   pnpm run cloudrun:push
   ```

4. **Deploy to Cloud Run**:
   ```bash
   pnpm run cloudrun:deploy
   ```

## GitHub Actions Deployment

To use GitHub Actions for automated deployment:

1. **Create Service Account for GitHub Actions**:
   ```bash
   # Create a service account
   gcloud iam service-accounts create github-actions
   
   # Grant necessary permissions
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/run.admin"
     
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/artifactregistry.admin"
     
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:github-actions@$PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

2. **Configure Workload Identity Federation**:
   
   Follow the [Google Cloud documentation](https://cloud.google.com/iam/docs/workload-identity-federation-with-github-actions) to set up Workload Identity Federation for GitHub Actions.

3. **Add Required Secrets to GitHub Repository**:
   
   Add the following secrets to your GitHub repository:
   - `GCP_PROJECT_ID`: Your Google Cloud project ID
   - `GCP_WORKLOAD_IDENTITY_PROVIDER`: The workload identity provider
   - `GCP_SERVICE_ACCOUNT`: The service account email

4. **Trigger a Deployment**:
   
   Push to the `cloud-run-deploy` branch or manually trigger the workflow from GitHub Actions.

## Environment Variables

The Cloud Run deployment uses the following environment variables:

| Name | Description |
|------|-------------|
| `RUNNING_IN_CLOUD_RUN` | Set to "true" to indicate Cloud Run environment |
| `NODE_ENV` | Set to "production" for production deployment |
| `ANTHROPIC_API_KEY` | API key for Anthropic (Claude) |
| `OPENAI_API_KEY` | API key for OpenAI |
| `BETA_ACCESS_CODES` | Comma-separated list of beta access codes |

## Troubleshooting

- **Container fails to start**: Check the Cloud Run logs
- **API calls failing**: Verify that secrets are correctly set up
- **Cold start issues**: Adjust the `min-instances` parameter

## Architecture Differences

When running on Google Cloud Run:

1. Instead of using Cloudflare Workers, the application uses an Express.js server
2. File system operations are disabled by default
3. Webhook testing is enabled for easier integration
4. The application detects the environment and adjusts feature flags accordingly 