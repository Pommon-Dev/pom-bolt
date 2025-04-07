import React from 'react';

export default function DebugPanel() {
  // Define functions to handle button clicks
  function testCredentials() {
    // This function is defined in the script tag
    // TypeScript doesn't know about it, but it will be available at runtime
    (window as any).testCredentials();
  }

  function testDeployment() {
    // This function is defined in the script tag
    (window as any).testDeployment();
  }

  function checkTargets() {
    // This function is defined in the script tag
    (window as any).checkTargets();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Deployment Debug Panel</h1>
      
      <div className="mb-8 p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Test Cloudflare Credentials</h2>
        <div className="mb-4">
          <p>Enter your Cloudflare credentials to test target creation:</p>
        </div>
        
        <div className="grid gap-4 mb-4">
          <div>
            <label className="block mb-1">Account ID:</label>
            <input
              type="text"
              id="accountId"
              className="w-full p-2 border rounded"
              placeholder="Enter Cloudflare Account ID"
            />
          </div>
          
          <div>
            <label className="block mb-1">API Token:</label>
            <input
              type="password"
              id="apiToken"
              className="w-full p-2 border rounded"
              placeholder="Enter Cloudflare API Token"
            />
          </div>
          
          <div>
            <label className="block mb-1">Project Name:</label>
            <input
              type="text"
              id="projectName"
              className="w-full p-2 border rounded"
              placeholder="Project name (default: genapps)"
              defaultValue="genapps"
            />
          </div>
        </div>
        
        <button
          onClick={() => testCredentials()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Test Credentials
        </button>
      </div>
      
      <div className="mb-8 p-4 border rounded">
        <h2 className="text-xl font-semibold mb-4">Test Deployment</h2>
        <div className="mb-4">
          <p>Deploy a test project using the credentials above:</p>
        </div>
        
        <button
          onClick={() => testDeployment()}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 mr-4"
        >
          Test Deployment
        </button>
        
        <button
          onClick={() => checkTargets()}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Check Available Targets
        </button>
      </div>
      
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
            const accountId = document.getElementById('accountId').value;
            const apiToken = document.getElementById('apiToken').value;
            const projectName = document.getElementById('projectName').value || 'genapps';
            
            try {
              const response = await fetch('/api/debug-target-creation', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ accountId, apiToken, projectName })
              });
              
              const data = await response.json();
              window.showResults(data);
            } catch (error) {
              window.showResults({ error: error.message });
            }
          }
          
          window.testDeployment = async function() {
            const accountId = document.getElementById('accountId').value;
            const apiToken = document.getElementById('apiToken').value;
            const projectName = document.getElementById('projectName').value || 'genapps';
            
            try {
              const response = await fetch('/api/deploy', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  name: "test-project",
                  target: "cloudflare-pages",
                  files: {
                    "index.html": "<html><body><h1>Test Project</h1><p>Created from Debug Panel</p></body></html>"
                  },
                  cfCredentials: {
                    accountId,
                    apiToken
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