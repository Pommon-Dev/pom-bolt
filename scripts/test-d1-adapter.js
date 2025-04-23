#!/usr/bin/env node

/**
 * Test D1 adapter directly
 * This script tests the D1 adapter by simulating how it interacts with the database
 */

import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// Check if the requirements project exists
console.log('Checking if requirements project exists...');
const checkSql = `SELECT * FROM projects WHERE id = 'requirements';`;

try {
  console.log('Executing SQL command:', checkSql);
  const result = execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${checkSql}"`, { 
    stdio: 'pipe',
    encoding: 'utf-8'
  });
  
  console.log('Result from database:');
  console.log(result);
  
  if (result.includes('requirements')) {
    console.log('✅ Requirements project exists in the database');
  } else {
    console.log('❌ Requirements project not found in the database');
  }
  
  // Now try to simulate how the ProjectStateManager works
  console.log('\nSimulating ProjectStateManager getProject...');
  
  // Get CloudflareProjectStorage logic: it uses a projectListKey to track projects
  const projectListKey = 'pom_bolt_project_list';
  
  console.log('Checking if project is in the project list...');
  const listCheckSql = `SELECT * FROM projects WHERE name = 'project_list' OR id = '${projectListKey}';`;
  
  const listResult = execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${listCheckSql}"`, { 
    stdio: 'pipe',
    encoding: 'utf-8'
  });
  
  console.log('Project list query result:');
  console.log(listResult);
  
  // Create project list if it doesn't exist
  if (!listResult.includes('project_list') && !listResult.includes(projectListKey)) {
    console.log('Project list not found, creating it...');
    const now = Date.now();
    const createListSql = `
    INSERT INTO projects (id, name, metadata, created_at, updated_at) 
    VALUES ('${projectListKey}', 'project_list', '[]', ${now}, ${now});
    `;
    
    execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${createListSql}"`, { 
      stdio: 'inherit'
    });
    
    // Now add the requirements project to the list
    const projectListData = JSON.stringify([
      {
        id: 'requirements',
        updatedAt: now,
        createdAt: now
      }
    ]);
    
    const updateListSql = `
    UPDATE projects 
    SET metadata = '${projectListData}', updated_at = ${now} 
    WHERE id = '${projectListKey}';
    `;
    
    execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${updateListSql}"`, { 
      stdio: 'inherit'
    });
    
    console.log('✅ Project list created and requirements project added');
  } else {
    console.log('Project list exists, checking if requirements project is in the list...');
    
    // Get the current list
    const getCurrentListSql = `SELECT metadata FROM projects WHERE id = '${projectListKey}';`;
    const currentListResult = execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${getCurrentListSql}"`, { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    
    console.log('Current project list:');
    console.log(currentListResult);
    
    // Parse the list and add requirements if not present
    try {
      let listData = JSON.parse(currentListResult.match(/{.*}/s)?.[0] || '[]');
      if (!Array.isArray(listData)) {
        listData = [];
      }
      
      const hasRequirements = listData.some(project => project.id === 'requirements');
      
      if (!hasRequirements) {
        console.log('Requirements project not in list, adding it...');
        const now = Date.now();
        listData.push({
          id: 'requirements',
          updatedAt: now,
          createdAt: now
        });
        
        const updatedListData = JSON.stringify(listData);
        const updateListSql = `
        UPDATE projects 
        SET metadata = '${updatedListData}', updated_at = ${now} 
        WHERE id = '${projectListKey}';
        `;
        
        execSync(`npx wrangler d1 execute pom_bolt_metadata --local --command="${updateListSql}"`, { 
          stdio: 'inherit'
        });
        
        console.log('✅ Requirements project added to project list');
      } else {
        console.log('✅ Requirements project already in project list');
      }
    } catch (error) {
      console.error('Error parsing project list:', error);
    }
  }
  
  console.log('\nTest complete. The requirements project should now be properly set up in the D1 database.');
} catch (error) {
  console.error('Error:', error.message);
} 