#!/usr/bin/env node

/**
 * Initialize requirements project in D1 database
 * This script creates the 'requirements' project in the D1 database
 * Run with: node scripts/init-requirements-project.js
 */

import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// SQL command to insert the requirements project
const requirementsId = process.env.REQUIREMENTS_ID || 'requirements';
const now = Date.now();
const projectName = 'Requirements Collection';
const metadata = JSON.stringify({ type: 'requirements' });

// D1 SQL command to insert the requirements project
const insertCommand = `
INSERT INTO projects (id, name, metadata, created_at, updated_at, user_id) 
VALUES ('${requirementsId}', '${projectName}', '${metadata}', ${now}, ${now}, NULL)
ON CONFLICT (id) DO UPDATE SET 
  name = '${projectName}', 
  metadata = '${metadata}',
  updated_at = ${now};
`;

console.log('Initializing requirements project in D1...');

try {
  // Execute the D1 command
  console.log('SQL Command:', insertCommand);
  
  // Execute for local D1
  execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${insertCommand}"`, { stdio: 'inherit' });
  
  console.log('\nLocalDevelopment: Requirements project initialized successfully in local D1');
  
  // Optionally, also initialize in remote D1 if the --remote flag is provided
  if (process.argv.includes('--remote')) {
    execSync(`npx wrangler d1 execute pom_bolt_metadata --command="${insertCommand}"`, { stdio: 'inherit' });
    console.log('Production: Requirements project initialized successfully in remote D1');
  }
} catch (error) {
  console.error('Error initializing requirements project:', error.message);
  process.exit(1);
} 