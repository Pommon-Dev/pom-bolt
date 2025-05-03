# Pom-Bolt Architecture v2: Event-Driven Microservices

Looking at your system, the key issues are:

1. Cloudflare Pages has execution limitations that affect system operations needed for GitHub and deployment integrations
2. Consistency issues with the current workarounds
3. Reliability challenges in the multi-phase flow
4. Scalability concerns for handling many projects

## Recommended Architecture: Event-Driven Microservices

I recommend separating your system into specialized microservices connected via an event queue:

```
┌─────────────────┐   ┌─────────────────┐   ┌────────────────────────┐
│ CF Pages        │   │ Message Queue   │   │ Backend Services       │
│ (Frontend + API)│──▶│ (SQS/Kafka/etc) │──▶│ (Cloud Functions/      │
└─────────────────┘   └─────────────────┘   │  Containerized Services)│
                            │                └────────────────────────┘
                            │                         ▲
                            │                         │
                            ▼                         │
                      ┌────────────────┐      ┌──────┴─────────┐
                      │ State Store    │      │ Shared Storage │
                      │ (KV/D1)        │      │ (S3/R2/etc)    │
                      └────────────────┘      └────────────────┘
```

### Components:

1. **Frontend + Initial API (CF Pages)**
   - Keep your existing frontend
   - Maintain lightweight API endpoints for request acceptance and status checking
   - Store project metadata and initial state in KV/D1

2. **Message Queue**
   - AWS SQS, Cloudflare Queues, or similar service
   - Decouple request handling from execution

3. **Backend Services**
   - Dedicated services for each phase (code generation, GitHub integration, deployment)
   - Run on platforms with fewer restrictions (AWS Lambda, Google Cloud Functions, etc.)
   - Can use Docker containers for more complex operations

4. **Shared Storage**
   - S3/R2 for storing generated code files
   - Shared across all components

## Step-by-Step Implementation Plan

### Phase 1: API Gateway & Event Queue (Weeks 1-2)

1. **Set up message queue infrastructure**
   - Select a queue service (AWS SQS, Cloudflare Queues, etc.)
   - Configure queue with appropriate settings (retention, visibility timeout, etc.)
   - Create separate queues for each processing phase

2. **Modify CF Pages API**
   - Update `/api/requirements` to parse requests and create initial state
   - Implement queue producer logic to enqueue jobs
   - Create project status endpoint for polling progress

3. **Set up shared state mechanism**
   - Define project status schema in KV/D1
   - Implement status update functions accessible to all services
   - Create transaction logic for atomic updates

4. **Implement authentication between services**
   - Set up service-to-service authentication
   - Create secure credential passing mechanism

### Phase 2: Code Generation Service (Weeks 3-4)

1. **Create serverless function infrastructure**
   - Set up AWS Lambda or similar serverless environment
   - Configure environment variables for LLM API access
   - Set up monitoring and logging

2. **Implement code generation worker**
   - Port existing code generation logic to the new service
   - Add queue consumer logic to process jobs
   - Implement error handling and retry mechanisms

3. **Set up shared storage for code files**
   - Configure S3/R2 bucket for generated code
   - Implement file upload/download utilities
   - Set up appropriate access controls

4. **Enhance status reporting**
   - Update status in KV/D1 at key checkpoints
   - Report detailed progress information
   - Handle failures with appropriate status updates

### Phase 3: GitHub Integration Service (Weeks 5-6)

1. **Create GitHub integration service**
   - Set up serverless function or container service
   - Configure GitHub API access
   - Implement repository creation and file upload

2. **Implement event handling**
   - Connect to queue for receiving completed code generation jobs
   - Process GitHub integration tasks
   - Publish completion events to deployment queue

3. **Enhance error handling**
   - Implement GitHub API request retries
   - Add detailed error reporting
   - Create recovery mechanisms for failed operations

4. **Improve credential management**
   - Securely store and access GitHub credentials
   - Implement tenant-based credential isolation
   - Add credential validation before operations

### Phase 4: Deployment Service (Weeks 7-8)

1. **Create deployment service**
   - Set up serverless function or container service
   - Configure access to deployment targets (Netlify, etc.)
   - Implement deployment workflows

2. **Connect to event system**
   - Consume GitHub completion events
   - Process deployment tasks
   - Publish deployment results

3. **Implement deployment strategies**
   - Support multiple deployment targets
   - Handle different deployment configurations
   - Implement deployment verification

4. **Add monitoring and recovery**
   - Track deployment success rates
   - Implement alerting for failed deployments
   - Create manual intervention mechanisms

### Phase 5: Integration & Testing (Weeks 9-10)

1. **End-to-end testing**
   - Update test scripts to work with the new architecture
   - Test complete workflows with different scenarios
   - Verify system behavior with error conditions

2. **Performance optimization**
   - Identify and address bottlenecks
   - Optimize resource utilization
   - Configure auto-scaling

3. **Documentation update**
   - Update architecture documentation
   - Create service-specific documentation
   - Update API documentation

4. **Monitoring and observability**
   - Set up centralized logging
   - Implement distributed tracing
   - Create performance dashboards

## Refactoring Major Modules for the New Architecture

### Core Services Mapping

Here's how the existing modules could be mapped to the new microservices architecture:

1. **Requirements API → API Gateway Service**
   - Keep the API routes in Cloudflare Pages
   - Modify to focus on request validation and queueing
   - Enhance with status tracking endpoints

   ```typescript
   // Currently in app/routes/api.requirements.ts
   // Would be split into:
   // 1. app/routes/api.requirements.ts (lightweight request handler)
   // 2. app/routes/api.project-status.ts (status endpoint)
   ```

2. **Requirements Chain → Code Generation Service**
   - Move the core LLM interaction to a dedicated service
   - Focus on processing project state and generating code

   ```typescript
   // Currently in app/lib/middleware/requirements-chain.ts
   // Would become:
   // 1. services/code-generation/src/processRequirements.ts
   // 2. services/code-generation/src/enhanceGeneratedCode.ts
   ```

3. **GitHub Integration → GitHub Service**
   - Move all GitHub logic to a dedicated service
   - Focus solely on repository operations

   ```typescript
   // Currently in app/lib/middleware/github-integration.ts
   // Would become:
   // services/github-integration/src/setupRepository.ts
   ```

4. **Deployment System → Deployment Service**
   - Extract deployment logic to a dedicated service
   - Support multiple deployment targets

   ```typescript
   // Currently in app/lib/deployment/ modules
   // Would become:
   // 1. services/deployment/src/targets/netlify.ts
   // 2. services/deployment/src/targets/cloudflare.ts
   ```

### Approach to Building New Services

I recommend using **AWS as the cloud platform** for these services, specifically:

1. **AWS Lambda** for serverless functions
2. **AWS SQS** for message queues
3. **AWS S3** for file storage
4. **AWS DynamoDB** for additional state if needed

This selection offers:
- Pay-per-use pricing model
- Robust scaling capabilities
- Rich ecosystem of supporting services
- Strong developer tooling

#### Implementation Strategy for Each Service:

1. **Code Generation Service**
   - Use AWS Lambda with sufficient memory allocation for LLM processing
   - Set appropriate timeout values (at least 5 minutes)
   - Configure with environment variables for LLM API keys
   - Use AWS SDK to interact with SQS and S3

   ```typescript
   // Example Lambda handler for code generation
   import { SQSEvent } from 'aws-lambda';
   import { S3Client } from '@aws-sdk/client-s3';
   import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
   import { LLMService } from './services/llm';
   
   export async function handler(event: SQSEvent): Promise<void> {
     for (const record of event.Records) {
       const payload = JSON.parse(record.body);
       
       try {
         // Update project status
         await updateProjectStatus(payload.projectId, 'processing');
         
         // Process requirements with LLM
         const llmService = new LLMService();
         const generatedCode = await llmService.generateCode(payload.requirements);
         
         // Store generated files in S3
         await storeGeneratedFiles(payload.projectId, generatedCode);
         
         // Update project status
         await updateProjectStatus(payload.projectId, 'generated');
         
         // Send message to GitHub queue
         if (payload.setupGitHub) {
           await sendToGitHubQueue(payload.projectId, payload.credentials?.github);
         }
       } catch (error) {
         // Handle errors
         await updateProjectStatus(payload.projectId, 'error', error.message);
       }
     }
   }
   ```

2. **GitHub Integration Service**
   - Use AWS Lambda with longer timeouts for API operations
   - Pre-install GitHub SDK dependencies
   - Handle credential validation and error recovery

   ```typescript
   // GitHub service implementation
   import { Octokit } from '@octokit/rest';
   
   export class GitHubService {
     private octokit: Octokit;
     
     constructor(token: string) {
       this.octokit = new Octokit({ auth: token });
     }
     
     async createRepository(name: string, isPrivate = true): Promise<string> {
       const response = await this.octokit.repos.createForAuthenticatedUser({
         name,
         private: isPrivate,
         auto_init: true
       });
       
       return response.data.html_url;
     }
     
     async uploadFiles(owner: string, repo: string, files: Record<string, string>): Promise<void> {
       // Implementation details for uploading files
     }
   }
   ```

3. **Deployment Service**
   - Use AWS Lambda or ECS for more complex deployment tasks
   - Implement adapters for different deployment targets
   - Provide detailed status updates

   ```typescript
   // Deployment service factory pattern
   export abstract class DeploymentTarget {
     abstract deploy(options: DeploymentOptions): Promise<DeploymentResult>;
   }
   
   export class NetlifyTarget extends DeploymentTarget {
     private netlifyClient: NetlifyClient;
     
     constructor(apiToken: string) {
       super();
       this.netlifyClient = new NetlifyClient(apiToken);
     }
     
     async deploy(options: DeploymentOptions): Promise<DeploymentResult> {
       // Implementation for Netlify deployment
     }
   }
   ```

### Shared Components

1. **Project State Manager**
   - Implement as a shared library used by all services
   - Use KV/D1 for storing metadata
   - Use S3/R2 for storing files

   ```typescript
   // Shared project state manager
   export class ProjectStateManager {
     private db: D1Database;
     private storage: S3Client;
     
     constructor(db: D1Database, storage: S3Client) {
       this.db = db;
       this.storage = storage;
     }
     
     async getProject(projectId: string): Promise<Project | null> {
       // Implementation for getting project metadata
     }
     
     async updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
       // Implementation for updating project metadata
     }
     
     async getProjectFiles(projectId: string): Promise<Record<string, string>> {
       // Implementation for retrieving project files from S3
     }
   }
   ```

2. **Authentication & Authorization**
   - Implement service-to-service authentication
   - Use AWS IAM roles for service permissions
   - Create secure methods for passing credentials between services

3. **Monitoring & Logging**
   - Implement consistent logging across all services
   - Use AWS CloudWatch for log aggregation
   - Set up alerts for service failures

### Data Synchronization Strategy

To maintain consistency across distributed services:

1. Use **optimistic concurrency control** for KV/D1 updates
2. Implement **idempotent operations** in all services
3. Use **unique request IDs** for tracking operations across services
4. Implement **compensating transactions** for recovery

### Testing Strategy

1. Create **component tests** for each service
2. Implement **integration tests** for service interactions
3. Develop **end-to-end tests** to verify complete workflows
4. Set up **continuous integration** to run all tests on changes

## Conclusion

Migrating to this event-driven microservices architecture will significantly improve the reliability, scalability, and maintainability of your requirements-to-deployment workflow. By decoupling the frontend from the complex processing tasks, you gain the ability to:

1. Scale each component independently
2. Use the most appropriate platform for each service
3. Improve fault isolation and recovery
4. Enable easier monitoring and debugging

The initial implementation effort is substantial, but the long-term benefits in terms of system robustness and developer productivity will outweigh the upfront costs. Starting with clear service boundaries and a well-defined event flow will ensure a successful transition to this new architecture. 