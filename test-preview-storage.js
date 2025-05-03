/**
 * Test script to verify storage access in Preview environment
 * Run this script using: node test-preview-storage.js
 */

import { execSync } from 'node:child_process';

// Test database access
console.log('Testing D1 database access:');
try {
  const dbOutput = execSync(
    'wrangler d1 execute pom-bolt-db-preview --command="SELECT COUNT(*) FROM projects;" --remote',
    { encoding: 'utf8' }
  );
  console.log('D1 Database access successful:');
  console.log(dbOutput);
} catch (error) {
  console.error('D1 Database access failed:', error.message);
}

// Test KV namespace access
console.log('\nTesting KV namespace access:');
// First put a test value
try {
  const kvPutOutput = execSync(
    'wrangler kv key put "preview:test-script" "Test value from script" --namespace-id=996fde3f9f0844e49ec426ab5ed96895 --preview --remote',
    { encoding: 'utf8' }
  );
  console.log('KV Put operation successful:');
  console.log(kvPutOutput);
} catch (error) {
  console.error('KV Put operation failed:', error.message);
}

// Then read it back
try {
  const kvGetOutput = execSync(
    'wrangler kv key get "preview:test-script" --namespace-id=996fde3f9f0844e49ec426ab5ed96895 --preview --remote',
    { encoding: 'utf8' }
  );
  console.log('KV Get operation successful:');
  console.log('Retrieved value:', kvGetOutput.trim());
} catch (error) {
  console.error('KV Get operation failed:', error.message);
}

console.log('\nStorage test complete!'); 