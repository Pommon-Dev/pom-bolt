import fetch from 'node-fetch';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const PROJECT_NAME = 'pom-bolt'; // Your Cloudflare Pages project name

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set');
  process.exit(1);
}

interface CloudflareResponse<T> {
  result: T;
  success: boolean;
  errors: any[];
  messages: string[];
}

interface Deployment {
  id: string;
  url: string;
  environment: string;
}

async function purgeCache() {
  try {
    // First, verify the project exists
    console.log(`Checking project ${PROJECT_NAME}...`);
    const projectResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!projectResponse.ok) {
      console.error(`❌ Error: Project not found or API token doesn't have access. Status: ${projectResponse.status}`);
      process.exit(1);
    }

    // Get the latest deployment
    console.log('Fetching latest deployment...');
    const deploymentsResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments?page=1&per_page=1`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const deploymentsData = await deploymentsResponse.json() as CloudflareResponse<Deployment[]>;

    if (!deploymentsData.success || !deploymentsData.result || deploymentsData.result.length === 0) {
      console.error('❌ Error: Could not find any deployments for this project');
      process.exit(1);
    }

    const deploymentId = deploymentsData.result[0].id;
    console.log(`Found deployment: ${deploymentId}`);

    // Purge cache for the specific deployment
    console.log('Purging cache...');
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments/${deploymentId}/cache_purge`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          purge_everything: true,
        }),
      }
    );

    const data = await response.json() as CloudflareResponse<null>;

    if (data.success) {
      console.log('✅ Cache purged successfully for Pages project:', PROJECT_NAME);
    } else {
      console.error('❌ Failed to purge cache:', data.errors);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error purging cache:', error);
    process.exit(1);
  }
}

purgeCache(); 