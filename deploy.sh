#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting deployment process..."

# Build the application
echo "📦 Building the application..."
npm run build

# Deploy to Cloudflare Pages
echo "☁️ Deploying to Cloudflare Pages..."
npx wrangler pages deploy ./build/client --project-name=pom-bolt

echo "✅ Deployment complete!" 