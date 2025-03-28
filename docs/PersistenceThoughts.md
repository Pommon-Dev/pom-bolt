# Project Persistence and Architecture Considerations

## Overview
This document captures the architectural considerations and requirements for implementing persistent project storage and management in the application. It addresses both UI-based and API/webhook-based approaches for project creation and modification.

## Feature Requirements

### Feature 1: Create New Project from Prompt/PRD
Two approaches need to be supported:
1. UI-based creation with code generation and preview in webcontainer
2. API/webhook-based headless creation with automatic deployment

Both approaches require:
- Project ID persistence
- Project codebase mapping
- Unique client ID association

### Feature 2: Add New Feature to Existing Project
Two approaches need to be supported:
1. UI-based modification within existing chat stream
2. API/webhook-based headless modification

## Current Architecture Analysis

### UI Approach Components
**Frontend**:
- Chat interface for prompt/PRD input
- WebContainer instance for code generation and preview
- Temporary filesystem in browser memory

**Backend**:
- Chat history storage
- `/api/requirements` endpoint

**Data Flow**:
1. User inputs prompt/requirements in UI
2. System generates code in WebContainer
3. Code exists only in current browser session
4. Chat history may be persisted

### API/Webhook Approach Requirements
**Missing Components**:
1. Authentication/authorization system for API clients
2. Client ID management system
3. Persistent storage for generated codebases
4. Deployment integration with Cloudflare/Netlify/Vercel
5. Project metadata storage

## Core Architectural Needs

### 1. Persistent Storage Layer
- Filesystem abstraction for both browser and server
- Options include:
  - S3/equivalent cloud storage
  - Git repositories
  - Database BLOBs
- Must store complete code structure with file hierarchy

### 2. Project Identity System
- Unique project IDs that persist beyond browser session
- Client ID association for authorization
- Version tracking for modifications

### 3. Code Generation Service
- Currently browser-dependent via WebContainer
- Need server-side equivalent without browser dependency
- Options:
  - Containerized environments
  - Direct filesystem manipulation

### 4. Deployment Integration
- API connectors to Cloudflare/Netlify/Vercel
- Deployment configuration storage
- Status tracking and webhook notifications

## API Design Considerations

### Requirements Endpoint Structure
```typescript
interface RequirementsRequest {
  clientId: string;           // Authentication
  projectId?: string;         // Optional - if adding to existing project
  requirements: string;       // PRD or feature description
  deployment?: {              // Optional deployment settings
    platform: 'cloudflare' | 'netlify' | 'vercel';
    settings: Record<string, any>;
  };
}

interface RequirementsResponse {
  projectId: string;          // New or existing project ID
  status: 'pending' | 'complete' | 'error';
  codeUrl?: string;           // URL to access code repository
  deploymentUrl?: string;     // URL to deployed application
  previewUrl?: string;        // URL to preview if not deployed
}
```

## Implementation Strategy

### Key Architectural Decision
The biggest architectural shift involves moving from a browser-centric code generation model to one that can operate headlessly. This requires either:

1. Replicating WebContainer functionality on the server, or
2. Creating a service that can manipulate code directly on the filesystem

### Next Steps for Decision-Making
1. Determine expected volume and scale of projects
2. Decide on persistence strategy (file storage vs. database)
3. Evaluate deployment integration complexity
4. Consider maintaining WebContainer for UI while adding server alternative, or unifying both approaches

## Open Questions
1. What is the expected scale of projects and storage requirements?
2. Should we maintain separate code generation paths for UI and API?
3. How should we handle project versioning and history?
4. What are the security implications of storing codebases?
5. How should we handle deployment failures and rollbacks? 