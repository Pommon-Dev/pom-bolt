/**
 * Express Server for Google Cloud Run
 * 
 * This server is used to serve the Remix application in a containerized environment.
 * It handles both static assets and API routes appropriately.
 */

const express = require('express');
const path = require('path');
const compression = require('compression');
const serveStatic = require('serve-static');
const fs = require('fs');

// Initialize express app
const app = express();

// Enable gzip compression for all responses
app.use(compression());

// Get port from environment variable or use 8080 as default
const PORT = process.env.PORT || 8080;

// Path to the client build directory
const CLIENT_BUILD_DIR = path.join(__dirname, 'build/client');

// Path to the server build directory
const SERVER_BUILD_DIR = path.join(__dirname, 'build/server');

// Check if running in Google Cloud Run environment (for environment detection)
process.env.RUNNING_IN_CLOUD_RUN = 'true';

// Serve static assets with cache control
app.use(
  '/',
  serveStatic(CLIENT_BUILD_DIR, {
    index: false,
    setHeaders: (res, path) => {
      // Set cache control headers based on file types
      if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.wasm')) {
        // Long cache for immutable assets (they have content hash in filename)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (
        path.endsWith('.jpg') || 
        path.endsWith('.jpeg') || 
        path.endsWith('.png') || 
        path.endsWith('.gif') || 
        path.endsWith('.svg') || 
        path.endsWith('.webp')
      ) {
        // Images can be cached but should revalidate
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        // Other static assets
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  })
);

// Handle API routes
app.use('/api', (req, res, next) => {
  console.log(`API Request: ${req.method} ${req.originalUrl}`);
  // Pass to the Remix backend
  next();
});

// Health check endpoint for Cloud Run
app.get('/_health', (req, res) => {
  res.status(200).send('OK');
});

// For all other requests, serve the index.html
app.get('*', (req, res) => {
  console.log(`Request: ${req.method} ${req.originalUrl}`);
  
  // Check if the request is for an API route or a non-static file
  if (req.originalUrl.startsWith('/api/') || !req.originalUrl.includes('.')) {
    // Serve the index.html file for client-side routing to handle
    const indexHtml = path.join(CLIENT_BUILD_DIR, 'index.html');
    
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml);
    } else {
      res.status(404).send('Not found');
    }
  } else {
    // Otherwise, it's a 404
    res.status(404).send('Not found');
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
}); 