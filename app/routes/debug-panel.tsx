import React from 'react';

export default function DebugPanel() {
  // Define functions to handle button clicks
  function testCredentials() {
    (window as any).testCredentials();
  }

  function testNetlifyDeployment() {
    (window as any).testNetlifyDeployment();
  }

  function testCloudflareDeployment() {
    (window as any).testCloudflareDeployment();
  }

  function checkTargets() {
    (window as any).checkTargets();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Deployment Debug Panel</h1>
      
      {/* --- Cloudflare Credentials Section --- */}
      <div className="mb-8 p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Cloudflare Credentials</h2>
        <div className="grid gap-4 mb-4">
          <div>
            <label className="block mb-1">Account ID:</label>
            <input type="text" id="cfAccountId" className="w-full p-2 border rounded" placeholder="Enter Cloudflare Account ID" />
          </div>
          <div>
            <label className="block mb-1">API Token:</label>
            <input type="password" id="cfApiToken" className="w-full p-2 border rounded" placeholder="Enter Cloudflare API Token" />
          </div>
          <div>
            <label className="block mb-1">Project Name:</label>
            <input type="text" id="cfProjectName" className="w-full p-2 border rounded" placeholder="CF project (default: genapps)" defaultValue="genapps" />
          </div>
        </div>
      </div>

      {/* --- Netlify Credentials Section --- */}
      <div className="mb-8 p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Netlify Credentials</h2>
        <div className="grid gap-4 mb-4">
          <div>
            <label className="block mb-1">API Token (PAT):</label>
            <input type="password" id="netlifyToken" className="w-full p-2 border rounded" placeholder="Enter Netlify Personal Access Token" />
          </div>
        </div>
      </div>

      {/* --- Testing Section --- */}
      <div className="mb-8 p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Test Actions</h2>
        <div className="flex flex-wrap gap-4">
          <button onClick={testCredentials} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Test Target Creation</button>
          <button onClick={testNetlifyDeployment} className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600">Test Netlify Deploy</button>
          <button onClick={testCloudflareDeployment} className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600">Test Cloudflare Deploy</button>
          <button onClick={checkTargets} className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600">Check Available Targets</button>
        </div>
      </div>
      
      {/* --- Results Section --- */}
      <div className="p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Results</h2>
        <pre id="results" className="bg-gray-100 p-4 rounded overflow-auto max-h-96">Results will appear here...</pre>
      </div>
      
      <script dangerouslySetInnerHTML={{
        __html: `
          window.showResults = function(data) {
            document.getElementById('results').textContent = JSON.stringify(data, null, 2);
          }
          
          window.testCredentials = async function() {
            const cfAccountId = document.getElementById('cfAccountId').value;
            const cfApiToken = document.getElementById('cfApiToken').value;
            const cfProjectName = document.getElementById('cfProjectName').value || 'genapps';
            const netlifyToken = document.getElementById('netlifyToken').value;
            
            try {
              const response = await fetch('/api/debug-target-creation', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                  accountId: cfAccountId, 
                  apiToken: cfApiToken, 
                  projectName: cfProjectName,
                  netlifyToken: netlifyToken
                })
              });
              const data = await response.json();
              window.showResults(data);
            } catch (error) {
              window.showResults({ error: error.message });
            }
          }
          
          window.testNetlifyDeployment = async function() {
            const netlifyToken = document.getElementById('netlifyToken').value;
            
            try {
              const response = await fetch('/api/deploy', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  name: "test-netlify-deploy",
                  target: "netlify", // Explicitly target Netlify
                  files: {
                    "index.html": "<html><body><h1>Test Netlify Project</h1><p>Created from Debug Panel</p></body></html>"
                  },
                  netlifyCredentials: {
                    apiToken: netlifyToken
                  }
                })
              });
              const data = await response.json();
              window.showResults(data);
            } catch (error) {
              window.showResults({ error: error.message });
            }
          }

          window.testCloudflareDeployment = async function() {
            const cfAccountId = document.getElementById('cfAccountId').value;
            const cfApiToken = document.getElementById('cfApiToken').value;
            const cfProjectName = document.getElementById('cfProjectName').value || 'genapps';
            
            try {
              const response = await fetch('/api/deploy', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  name: "test-cf-deploy",
                  target: "cloudflare-pages", // Explicitly target Cloudflare
                  files: {
                    "index.html": "<html><body><h1>Test Cloudflare Project</h1><p>Created from Debug Panel</p></body></html>"
                  },
                  cfCredentials: {
                    accountId: cfAccountId,
                    apiToken: cfApiToken,
                    projectName: cfProjectName
                  }
                })
              });
              const data = await response.json();
              window.showResults(data);
            } catch (error) {
              window.showResults({ error: error.message });
            }
          }
          
          window.checkTargets = async function() {
            // This function remains the same, it checks targets based on env/context
            try {
              const response = await fetch('/api/debug-targets', {
                method: 'POST'
              });
              const data = await response.json();
              window.showResults(data);
            } catch (error) {
              window.showResults({ error: error.message });
            }
          }
        `
      }} />
    </div>
  );
} 