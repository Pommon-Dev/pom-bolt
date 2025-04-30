#!/usr/bin/env node

/**
 * Test script for multi-tenant deployments
 * 
 * This script tests deployment functionality with multiple tenants across environments
 * 
 * Usage:
 *   node scripts/test-multi-tenant-deployment.js [environment] [tenant-id]
 * 
 * Environment:
 *   - local (default): Tests against local development environment
 *   - preview: Tests against preview environment
 *   - production: Tests against production environment
 * 
 * Tenant ID:
 *   - Any string to use as tenant ID (default: test-tenant)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const [, , environment = 'local', tenantId = 'test-tenant'] = process.argv;

// Configuration for different environments
const ENV_CONFIGS = {
  local: {
    baseUrl: 'http://localhost:8788',
    apiKey: 'local-test-key'
  },
  preview: {
    baseUrl: 'https://preview.example.com',
    apiKey: process.env.PREVIEW_API_KEY || ''
  },
  production: {
    baseUrl: 'https://app.example.com',
    apiKey: process.env.PRODUCTION_API_KEY || ''
  }
};

// Validate environment
if (!ENV_CONFIGS[environment]) {
  console.error(`Error: Unknown environment "${environment}". Use local, preview, or production.`);
  process.exit(1);
}

const config = ENV_CONFIGS[environment];

// Validate API key for non-local environments
if (environment !== 'local' && !config.apiKey) {
  console.error(`Error: Missing API key for ${environment} environment.`);
  console.error(`Set ${environment.toUpperCase()}_API_KEY environment variable.`);
  process.exit(1);
}

console.log(`Running multi-tenant deployment tests on ${environment} environment with tenant ID: ${tenantId}`);

// Create a temporary project for testing
const projectId = `test-project-${Date.now()}`;
const projectName = `Test Project ${new Date().toISOString()}`;

// Sample project files
const projectFiles = {
  'index.html': `<!DOCTYPE html>
<html>
<head>
  <title>Multi-Tenant Test - ${tenantId}</title>
</head>
<body>
  <h1>Test Project for ${tenantId}</h1>
  <p>Environment: ${environment}</p>
  <p>Created: ${new Date().toISOString()}</p>
</body>
</html>`,
  'README.md': `# Test Project
This is a test project for multi-tenant deployment.
- Tenant ID: ${tenantId}
- Environment: ${environment}
- Created: ${new Date().toISOString()}
`
};

// Function to make API calls
async function callApi(endpoint, method = 'GET', data = null, headers = {}) {
  const url = `${config.baseUrl}/api/${endpoint}`;
  console.log(`${method} ${url}`);
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      ...headers
    }
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  const response = await fetch(url, options);
  const responseData = await response.json();
  
  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(JSON.stringify(responseData, null, 2));
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }
  
  return responseData;
}

// Main test function
async function runTests() {
  try {
    console.log('1. Creating test project...');
    const createResult = await callApi('project', 'POST', {
      name: projectName,
      tenantId
    });
    
    const newProjectId = createResult.data.id;
    console.log(`Project created with ID: ${newProjectId}`);
    
    console.log('2. Adding files to the project...');
    const addFilesResult = await callApi(`project/${newProjectId}/files`, 'POST', {
      files: projectFiles,
      tenantId
    });
    console.log(`Added ${Object.keys(projectFiles).length} files to the project`);
    
    console.log('3. Starting deployment...');
    const deploymentResult = await callApi('deploy', 'POST', {
      projectId: newProjectId,
      tenantId,
      targetName: 'netlify',
      // Note: You would need to provide valid credentials for actual deployment
      credentials: {
        netlify: {
          apiToken: process.env.NETLIFY_TOKEN || 'test-token'
        }
      }
    });
    
    const deploymentId = deploymentResult.deploymentId;
    console.log(`Deployment started with ID: ${deploymentId}`);
    
    // Poll deployment status
    console.log('4. Checking deployment status...');
    let deploymentCompleted = false;
    let attempts = 0;
    
    while (!deploymentCompleted && attempts < 10) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const statusResult = await callApi(`deploy?id=${deploymentId}&tenantId=${tenantId}`, 'GET');
      console.log(`Deployment status: ${statusResult.data.status}`);
      
      if (statusResult.data.status !== 'in-progress') {
        deploymentCompleted = true;
        
        if (statusResult.data.status === 'success') {
          console.log(`Deployment successful! URL: ${statusResult.data.url}`);
        } else {
          console.error('Deployment failed!');
          console.error(JSON.stringify(statusResult, null, 2));
        }
      }
    }
    
    if (!deploymentCompleted) {
      console.warn('Deployment did not complete within the timeout period');
    }
    
    // Test tenant isolation
    console.log('5. Testing tenant access control...');
    try {
      // Try accessing the project with a different tenant ID
      const wrongTenantId = `wrong-${tenantId}`;
      await callApi(`project/${newProjectId}`, 'GET', null, {
        'x-tenant-id': wrongTenantId
      });
      console.error('Access control test FAILED: Was able to access project with wrong tenant ID!');
    } catch (error) {
      console.log('Access control test PASSED: Could not access project with wrong tenant ID as expected');
    }
    
    console.log('Tests completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the tests
runTests(); 