#!/usr/bin/env node

/**
 * Fix requirements database setup
 * This script directly inserts the necessary records into the D1 database
 */

import { execSync } from 'child_process';

const now = Date.now();
console.log('Fixing D1 database requirements setup...');

// Function to execute D1 SQL commands and handle errors
function execD1Command(sql, local = true) {
  try {
    const flag = local ? '--local' : '';
    console.log(`Executing SQL (${local ? 'local' : 'remote'}):`);
    console.log(sql);
    
    const result = execSync(`npx wrangler d1 execute pom_bolt_metadata ${flag} --command="${sql}"`, { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    
    console.log('Result:');
    console.log(result);
    return { success: true, result };
  } catch (error) {
    console.error('Error executing SQL:', error.message);
    return { success: false, error: error.message };
  }
}

// 1. Insert the requirements project
const requirementsInsertSql = `
INSERT INTO projects (id, name, metadata, created_at, updated_at) 
VALUES ('requirements', 'Requirements Collection', '{"type":"requirements"}', ${now}, ${now})
ON CONFLICT (id) DO UPDATE SET 
  name = 'Requirements Collection', 
  metadata = '{"type":"requirements"}',
  updated_at = ${now};
`;

// 2. Insert the project list
const projectListInsertSql = `
INSERT INTO projects (id, name, metadata, created_at, updated_at) 
VALUES ('pom_bolt_project_list', 'Project List', '[{"id":"requirements","createdAt":${now},"updatedAt":${now}}]', ${now}, ${now})
ON CONFLICT (id) DO UPDATE SET 
  name = 'Project List', 
  metadata = '[{"id":"requirements","createdAt":${now},"updatedAt":${now}}]',
  updated_at = ${now};
`;

// 3. Check if the requirements project exists
const checkRequirementsSql = `SELECT * FROM projects WHERE id = 'requirements';`;

// 4. Check if the project list exists
const checkProjectListSql = `SELECT * FROM projects WHERE id = 'pom_bolt_project_list';`;

// Run all commands in sequence
console.log('1. Inserting requirements project...');
const requirementsResult = execD1Command(requirementsInsertSql);

console.log('\n2. Inserting project list...');
const projectListResult = execD1Command(projectListInsertSql);

console.log('\n3. Verifying requirements project...');
const checkRequirementsResult = execD1Command(checkRequirementsSql);

console.log('\n4. Verifying project list...');
const checkProjectListResult = execD1Command(checkProjectListSql);

// Final status report
console.log('\n=== SETUP COMPLETE ===');
console.log('Requirements project operation:', requirementsResult.success ? 'SUCCESS' : 'FAILED');
console.log('Project list operation:', projectListResult.success ? 'SUCCESS' : 'FAILED');
console.log('Requirements project exists:', checkRequirementsResult.result.includes('requirements') ? 'YES' : 'NO');
console.log('Project list exists:', checkProjectListResult.result.includes('pom_bolt_project_list') ? 'YES' : 'NO');

console.log('\nNow you should be able to use the /api/requirements endpoint successfully!');

// Optional: Also run for remote if --remote flag is provided
if (process.argv.includes('--remote')) {
  console.log('\n\n=== SETTING UP REMOTE DATABASE ===');
  console.log('1. Inserting requirements project in remote...');
  execD1Command(requirementsInsertSql, false);
  
  console.log('\n2. Inserting project list in remote...');
  execD1Command(projectListInsertSql, false);
  
  console.log('\n3. Verifying requirements project in remote...');
  execD1Command(checkRequirementsSql, false);
  
  console.log('\n4. Verifying project list in remote...');
  execD1Command(checkProjectListSql, false);
  
  console.log('\n=== REMOTE SETUP COMPLETE ===');
} 