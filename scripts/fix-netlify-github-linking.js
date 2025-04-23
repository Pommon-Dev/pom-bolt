#!/usr/bin/env node

/**
 * This script manually links a GitHub repository to a Netlify site and configures build settings.
 * It serves as a fallback if the automated deployment process in the app fails.
 * 
 * Usage:
 * node scripts/fix-netlify-github-linking.js <netlify_site_id> <github_repo_owner/repo_name> [main_branch] [build_cmd] [build_dir]
 * 
 * Example:
 * node scripts/fix-netlify-github-linking.js my-site-123abc your-username/your-repo main "npm run build" dist
 * 
 * Environment variables:
 * NETLIFY_TOKEN - Your Netlify personal access token
 */

// Dependencies
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Constants
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

// ANSI Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// Get arguments
const [siteId, githubRepo, branch = 'main', buildCmd = 'npm run build', buildDir = 'dist'] = process.argv.slice(2);
const netlifyToken = process.env.NETLIFY_TOKEN;

// Validate arguments
if (!siteId || !githubRepo || !netlifyToken) {
  console.error(`${colors.red}Error: Missing required arguments or environment variables${colors.reset}`);
  console.log(`
${colors.blue}Usage:${colors.reset}
  NETLIFY_TOKEN=your_token node scripts/fix-netlify-github-linking.js <netlify_site_id> <github_repo_owner/repo_name> [main_branch] [build_cmd] [build_dir]

${colors.blue}Example:${colors.reset}
  NETLIFY_TOKEN=your_token node scripts/fix-netlify-github-linking.js my-site-123abc your-username/your-repo main "npm run build" dist

${colors.blue}Required:${colors.reset}
  - NETLIFY_TOKEN environment variable 
  - Netlify site ID
  - GitHub repository (owner/repo format)
  `);
  process.exit(1);
}

// Utility functions
function getNetlifyHeaders() {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${netlifyToken}`);
  headers.set('Content-Type', 'application/json');
  return headers;
}

async function getSiteDetails(siteId) {
  console.log(`${colors.blue}Getting details for Netlify site ${siteId}...${colors.reset}`);
  
  try {
    const response = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
      headers: getNetlifyHeaders() 
    });
    
    if (!response.ok) {
      console.error(`${colors.red}Failed to get site details: ${response.statusText}${colors.reset}`);
      return null;
    }
    
    const data = await response.json();
    console.log(`${colors.green}Retrieved site details for ${data.name} (${data.id})${colors.reset}`);
    return data;
  } catch (error) {
    console.error(`${colors.red}Error getting site details: ${error.message}${colors.reset}`);
    return null;
  }
}

async function linkGitHubRepo(siteId, repoData) {
  console.log(`${colors.blue}Linking GitHub repo ${repoData.repo} to Netlify site ${siteId}...${colors.reset}`);
  
  const requestBody = {
    build_settings: {
      provider: 'github',
      repo_url: `https://github.com/${repoData.repo}`,
      repo_branch: repoData.branch,
      cmd: repoData.buildCmd,
      dir: repoData.buildDir
    }
  };
  
  console.log(`${colors.cyan}Request payload:${colors.reset}`, JSON.stringify(requestBody, null, 2));
  
  try {
    // Try direct linking method first
    const response = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
      method: 'PATCH',
      headers: getNetlifyHeaders(),
      body: JSON.stringify(requestBody)
    });
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error(`${colors.red}Failed to link GitHub repo using primary method: ${response.statusText}${colors.reset}`);
      console.log(`${colors.yellow}Response:${colors.reset}`, responseText);
      
      // Try alternative method
      console.log(`${colors.blue}Trying alternative linking method...${colors.reset}`);
      
      const altResponse = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/service-instances`, {
        method: 'POST',
        headers: getNetlifyHeaders(),
        body: JSON.stringify({
          service: 'github',
          repo: repoData.repo,
          branch: repoData.branch
        })
      });
      
      const altResponseText = await altResponse.text();
      
      if (!altResponse.ok) {
        console.error(`${colors.red}Alternative linking method failed: ${altResponse.statusText}${colors.reset}`);
        console.log(`${colors.yellow}Response:${colors.reset}`, altResponseText);
        return false;
      }
      
      console.log(`${colors.green}Successfully linked GitHub repo using alternative method${colors.reset}`);
      
      // Update build settings separately
      console.log(`${colors.blue}Updating build settings...${colors.reset}`);
      
      const buildResponse = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}`, {
        method: 'PATCH',
        headers: getNetlifyHeaders(),
        body: JSON.stringify({
          build_settings: {
            cmd: repoData.buildCmd,
            dir: repoData.buildDir
          }
        })
      });
      
      if (!buildResponse.ok) {
        console.error(`${colors.red}Failed to update build settings: ${buildResponse.statusText}${colors.reset}`);
        return false;
      }
      
      console.log(`${colors.green}Successfully updated build settings${colors.reset}`);
      return true;
    }
    
    console.log(`${colors.green}Successfully linked GitHub repo${colors.reset}`);
    try {
      const responseData = JSON.parse(responseText);
      console.log(`${colors.cyan}Response data:${colors.reset}`, JSON.stringify(responseData, null, 2));
    } catch (e) {
      console.log(`${colors.yellow}Raw response:${colors.reset}`, responseText);
    }
    
    return true;
  } catch (error) {
    console.error(`${colors.red}Error linking GitHub repo: ${error.message}${colors.reset}`);
    return false;
  }
}

async function verifyLinking(siteId) {
  console.log(`${colors.blue}Verifying GitHub linking for site ${siteId}...${colors.reset}`);
  
  const siteData = await getSiteDetails(siteId);
  if (!siteData) {
    return false;
  }
  
  const buildSettings = siteData.build_settings || {};
  const isLinked = buildSettings.provider === 'github' && !!buildSettings.repo_url;
  
  if (isLinked) {
    console.log(`${colors.green}Verification successful!${colors.reset}`);
    console.log(`${colors.green}Site is linked to GitHub repository: ${buildSettings.repo_url}${colors.reset}`);
    console.log(`${colors.blue}Build command:${colors.reset} ${buildSettings.cmd || '(Not set)'}`);
    console.log(`${colors.blue}Publish directory:${colors.reset} ${buildSettings.dir || '(Not set)'}`);
    return true;
  } else {
    console.error(`${colors.red}Verification failed - site is not linked to GitHub${colors.reset}`);
    return false;
  }
}

// Main function
async function main() {
  console.log(`${colors.blue}==============================================${colors.reset}`);
  console.log(`${colors.blue}  Netlify-GitHub Repository Linking Script   ${colors.reset}`);
  console.log(`${colors.blue}==============================================${colors.reset}`);
  
  // Get site details
  const siteData = await getSiteDetails(siteId);
  if (!siteData) {
    console.error(`${colors.red}Cannot proceed without site details${colors.reset}`);
    process.exit(1);
  }
  
  // Link the GitHub repository
  const linkSuccess = await linkGitHubRepo(siteId, {
    repo: githubRepo,
    branch: branch,
    buildCmd: buildCmd,
    buildDir: buildDir
  });
  
  if (!linkSuccess) {
    console.error(`${colors.red}Failed to link GitHub repository to Netlify site${colors.reset}`);
    process.exit(1);
  }
  
  // Verify the linking
  const verifySuccess = await verifyLinking(siteId);
  
  if (verifySuccess) {
    console.log(`${colors.green}==============================================${colors.reset}`);
    console.log(`${colors.green}  GitHub repository successfully linked to Netlify!  ${colors.reset}`);
    console.log(`${colors.green}==============================================${colors.reset}`);
    console.log(`${colors.blue}Netlify Site:${colors.reset} ${siteData.name}`);
    console.log(`${colors.blue}Site URL:${colors.reset} ${siteData.ssl_url || siteData.url}`);
    console.log(`${colors.blue}GitHub Repo:${colors.reset} ${githubRepo}`);
    process.exit(0);
  } else {
    console.error(`${colors.red}Linking verification failed. Please check your Netlify site settings manually.${colors.reset}`);
    console.log(`${colors.yellow}You can check your site at: https://app.netlify.com/sites/${siteData.name}/settings/deploys${colors.reset}`);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
  process.exit(1);
}); 