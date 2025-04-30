# Pom-Bolt Architecture Documentation

## System Overview

Pom-Bolt extends the Bolt.DIY platform, enhancing it with robust backend capabilities, persistence mechanisms, and deployment features. While Bolt.DIY provides a web-based IDE with AI assistance for coding, Pom-Bolt adds sophisticated backend APIs, project state management, and multi-target deployment options for generated applications.

## Core Architecture

### 1. High-Level System Components

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                              │
├───────────┬──────────┬────────────────┬───────────────┬──────────────────┤
│ Workbench │  Editor  │  Preview Panel │   Terminal    │       Chat       │
└───────────┴──────────┴────────────────┴───────────────┴──────────────────┘
      ▲          ▲             ▲               ▲                ▲
      │          │             │               │                │
      │          │             │               │                │
      ▼          ▼             ▼               ▼                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                        Application Core                                   │
├───────────────┬─────────────────┬───────────────────┬───────────────────┐
│ Development   │ Project State   │ Requirements      │ Deployment        │
│ Environment   │ Management      │ Chain             │ System            │
└───────────────┴─────────────────┴───────────────────┴───────────────────┘
      ▲                  ▲                 ▲                   ▲
      │                  │                 │                   │
      │                  │                 │                   │
      ▼                  ▼                 ▼                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         Backend Services                                  │
├───────────────┬─────────────────┬───────────────────┬───────────────────┐
│ API Routes    │ Environment     │ Persistence       │ LLM               │
│               │ Abstraction     │ Layer             │ Integration       │
└───────────────┴─────────────────┴───────────────────┴───────────────────┘
      ▲                  ▲                 ▲                   ▲
      │                  │                 │                   │
      │                  │                 │                   │
      ▼                  ▼                 ▼                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         External Services                                 │
├───────────────┬─────────────────┬───────────────────┬───────────────────┐
│ Cloudflare    │ Netlify         │ GitHub            │ LLM               │
│ (KV, D1)      │ (Hosting)       │ (Version Control) │ Providers         │
└───────────────┴─────────────────┴───────────────────┴───────────────────┘
```

### 2. Requirements to Deployment Flow

```
┌───────┐   ┌────────────┐   ┌────────────────┐   ┌───────────────────┐   ┌─────────────────┐   ┌────────────────┐
│ User  │   │  Chat UI/  │   │ Requirements   │   │  Project State    │   │  Deployment     │   │  External      │
│       │   │  API Route │   │ Chain          │   │  Manager          │   │  Manager        │   │  Services      │
└───────┘   └────────────┘   └────────────────┘   └───────────────────┘   └─────────────────┘   └────────────────┘
    │             │                  │                     │                        │                    │
    │ Requirements│                  │                     │                        │                    │
    │─────────────>                  │                     │                        │                    │
    │             │                  │                     │                        │                    │
    │             │ POST /api/       │                     │                        │                    │
    │             │ requirements     │                     │                        │                    │
    │             │─────────────────>│                     │                        │                    │
    │             │                  │                     │                        │                    │
    │             │                  │ Load/Create Project │                        │                    │
    │             │                  │─────────────────────>                        │                    │
    │             │                  │                     │                        │                    │
    │             │                  │ Project Context     │                        │                    │
    │             │                  │<─────────────────────                        │                    │
    │             │                  │                     │                        │                    │
    │             │                  │ Process Requirements│                        │                    │
    │             │                  │ (LLM Code Gen)      │                        │                    │
    │             │                  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─>│
    │             │                  │                     │                        │                    │
    │             │                  │ Generated Code      │                        │                    │
    │             │                  │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
    │             │                  │                     │                        │                    │
    │             │                  │ Update Project Files│                        │                    │
    │             │                  │─────────────────────>                        │                    │
    │             │                  │                     │                        │                    │
    │             │                  │ Should Deploy?      │                        │                    │
    │             │                  │─────────────────────────────────────────────>│                    │
    │             │                  │                     │                        │                    │
    │             │                  │                     │                        │ Get Project Files  │
    │             │                  │                     │<───────────────────────|                    │
    │             │                  │                     │                        │                    │
    │             │                  │                     │ Project Files          │                    │
    │             │                  │                     │──────────────────────> │                    │
    │             │                  │                     │                        │                    │
    │             │                  │                     │                        │ Deploy Project     │
    │             │                  │                     │                        │────────────────────>
    │             │                  │                     │                        │                    │
    │             │                  │                     │                        │ Deployment Result  │
    │             │                  │                     │                        │<────────────────────
    │             │                  │                     │                        │                    │
    │             │                  │                     │ Add Deployment         │                    │
    │             │                  │                     │<───────────────────────│                    │
    │             │                  │                     │                        │                    │
    │             │ Response with    │                     │                        │                    │
    │             │ Project Details  │                     │                        │                    │
    │             │<─────────────────│                     │                        │                    │
    │             │                  │                     │                        │                    │
    │ Result with │                  │                     │                        │                    │
    │ Deployment  │                  │                     │                        │                    │
    │<────────────│                  │                     │                        │                    │
    │             │                  │                     │                        │                    │
```

### 3. Bidirectional Project Sync Flow

```
┌───────┐   ┌────────────┐   ┌────────────────┐   ┌───────────────────┐   ┌────────────────┐
│ User  │   │  UI Layer  │   │ ProjectSync    │   │  Backend API      │   │  Storage       │
│       │   │            │   │ Service        │   │  Endpoints        │   │  (KV/D1)       │
└───────┘   └────────────┘   └────────────────┘   └───────────────────┘   └────────────────┘
    │             │                  │                     │                       │
    │ Visit App   │                  │                     │                       │
    │─────────────>                  │                     │                       │
    │             │                  │                     │                       │
    │             │ Mount            │                     │                       │
    │             │ BackgroundSync   │                     │                       │
    │             │─────────────────>│                     │                       │
    │             │                  │                     │                       │
    │             │                  │ GET /api/projects   │                       │
    │             │                  │─────────────────────>                       │
    │             │                  │                     │                       │
    │             │                  │                     │ Fetch Projects        │
    │             │                  │                     │───────────────────────>
    │             │                  │                     │                       │
    │             │                  │                     │ Backend Projects      │
    │             │                  │                     │<───────────────────────
    │             │                  │                     │                       │
    │             │                  │ Return Projects     │                       │
    │             │                  │<─────────────────────                       │
    │             │                  │                     │                       │
    │             │                  │ Merge with Local    │                       │
    │             │                  │ (localStorage)      │                       │
    │             │                  │─────┐               │                       │
    │             │                  │     │               │                       │
    │             │                  │<────┘               │                       │
    │             │                  │                     │                       │
    │             │                  │ POST /api/sync-projects                     │
    │             │                  │─────────────────────>                       │
    │             │                  │                     │                       │
    │             │                  │                     │ Store Projects        │
    │             │                  │                     │───────────────────────>
    │             │                  │                     │                       │
    │             │                  │                     │ Storage Result        │
    │             │                  │                     │<───────────────────────
    │             │                  │                     │                       │
    │             │                  │ Sync Result         │                       │
    │             │                  │<─────────────────────                       │
    │             │                  │                     │                       │
    │             │ Update UI        │                     │                       │
    │             │<─────────────────│                     │                       │
    │             │                  │                     │                       │
    │ See Synced  │                  │                     │                       │
    │ Projects    │                  │                     │                       │
    │<────────────│                  │                     │                       │
    │             │                  │                     │                       │
```

## Core Components

### 1. User Interface Layer (Inherited from Bolt.DIY)

The UI layer consists of several key components that provide the user-facing functionality, largely inherited from Bolt.DIY:

| Component      | Description                                           | Key Files                                |
|----------------|-------------------------------------------------------|-----------------------------------------|
| Workbench      | Main workspace environment                            | `app/components/workbench/`             |
| Editor         | Code editing interface                                | `app/components/editor/`                |
| Preview Panel  | Renders application previews                          | `app/components/ui/`                    |
| Terminal       | Command-line interface                                | `app/lib/stores/terminal.ts`            |
| Chat Interface | AI assistant chat interface                           | `app/components/chat/`                  |

### 2. Application Core (Pom-Bolt Extensions)

The application core extends Bolt.DIY with sophisticated backend capabilities:

| Component           | Description                                       | Key Files                                     |
|---------------------|---------------------------------------------------|----------------------------------------------|
| Development Environment | File and workspace operations                 | `app/lib/stores/files.ts`, `app/lib/stores/workbench.ts` |
| Project State Management | Manages project persistence and synchronization | `app/lib/projects/state-manager.ts`, `app/lib/projects/persistence/` |
| Requirements Chain | Processes natural language requirements into code  | `app/lib/middleware/requirements-chain.ts`    |
| Deployment System | Manages deployment of generated applications        | `app/lib/deployment/deployment-manager.ts`, `app/lib/deployment/targets/` |

### 3. Backend Services (Pom-Bolt Additions)

Pom-Bolt adds extensive backend services for handling API requests, environment abstractions, and persistence:

| Component           | Description                                      | Key Files                                     |
|---------------------|--------------------------------------------------|----------------------------------------------|
| API Routes          | RESTful endpoints for requirements, deployments  | `app/routes/api.requirements.ts`, `app/routes/api.deploy.ts`, `app/routes/api.sync-projects.ts` |
| Environment Abstraction | Abstracts environment differences (local, Cloudflare) | `app/lib/environments/base.ts`, `app/lib/environments/local.ts`, `app/lib/environments/cloudflare.ts` |
| Persistence Layer   | Handles data storage across environments         | `app/lib/kv/binding.ts`, `app/lib/projects/persistence/` |
| LLM Integration     | Connects to LLM providers for code generation    | `app/lib/llm/`, `app/lib/modules/llm/`       |

### 4. External Services

Pom-Bolt integrates with several external services for storage, hosting, and AI capabilities:

| Service             | Purpose                                           | Integration Files                            |
|---------------------|---------------------------------------------------|---------------------------------------------|
| Cloudflare KV & D1  | Project state persistence, file storage           | `app/lib/kv/binding.ts`, `app/lib/environments/cloudflare.ts` |
| Netlify             | Hosting for generated applications                | `app/lib/deployment/targets/netlify.ts`     |
| GitHub              | Version control for deployed applications         | `app/lib/deployment/targets/netlify-github.ts`, `app/lib/deployment/github-integration.ts` |
| LLM Providers       | AI models for code generation                     | `app/lib/modules/llm/providers/`            |

## Detailed Component Architecture

### 1. Project State Management

The Project State Management system provides robust persistence and synchronization of project data:

```
┌──────────────────────────────────────────────────┐
│              ProjectStateManager                 │
├──────────────────────────────────────────────────┤
│ - createProject()                                │
│ - getProject()                                   │
│ - updateProjectFiles()                           │
│ - addRequirements()                              │
│ - addDeployment()                                │
│ - getProjectFiles()                              │
└──────────────────────┬───────────────────────────┘
                       │
                       │
            ┌──────────▼───────────┐
            │  Storage Adapter     │
            │      Interface       │
            └──────────┬───────────┘
                       │
          ┌────────────┴───────────┐
          │                        │
┌─────────▼────────────┐  ┌────────▼──────────────┐
│  LocalProjectStorage │  │ CloudflareProject     │
│  (localStorage)      │  │ Storage (KV/D1)       │
└──────────────────────┘  └─────────────────────────┘
```

### 2. Requirements Chain

The Requirements Chain processes natural language into code through a middleware-based approach:

```
┌────────────────────────────────────────────────────┐
│              Requirements Chain                    │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────┐  │
│  │ parseRequest│──>│loadProject   │──>│process  │  │
│  │             │   │Context       │   │Requirements │
│  └─────────────┘   └──────────────┘   └─────────┘  │
│                                           │        │
│                                           │        │
│                                           ▼        │
│                                     ┌────────────┐ │
│                                     │ triggerDeploy │
│                                     │ (optional) │ │
│                                     └────────────┘ │
└────────────────────────────────────────────────────┘
```

### 3. Deployment System

The Deployment System manages multiple deployment targets through a unified interface:

```
┌──────────────────────────────────────────────────┐
│              DeploymentManager                   │
├──────────────────────────────────────────────────┤
│ - registerTarget()                               │
│ - getAvailableTargets()                          │
│ - selectPreferredTarget()                        │
│ - deployProject()                                │
│ - deployWithBestTarget()                         │
└────────────────────────┬─────────────────────────┘
                         │
                         │
              ┌──────────▼───────────┐
              │  DeploymentTarget    │
              │      Interface       │
              └──────────┬───────────┘
                         │
       ┌────────────────┬┴───────────────┬────────────────┐
       │                │                │                │
┌──────▼─────┐   ┌──────▼─────┐   ┌─────▼──────┐   ┌─────▼──────┐
│ Cloudflare │   │  Netlify   │   │ Netlify-   │   │ LocalZip   │
│ Pages      │   │            │   │ GitHub     │   │            │
└────────────┘   └────────────┘   └────────────┘   └────────────┘
                                        │
                                  ┌─────▼──────┐
                                  │  GitHub    │
                                  │Integration │
                                  └────────────┘
```

### 4. Environment Abstraction

The Environment Abstraction system normalizes differences between runtime environments:

```
┌──────────────────────────────────────────────────┐
│              EnvironmentDetector                 │
├──────────────────────────────────────────────────┤
│ - detectEnvironment()                            │
└────────────────────────┬─────────────────────────┘
                         │
                         │
              ┌──────────▼───────────┐
              │    Environment       │
              │      Interface       │
              └──────────┬───────────┘
                         │
                ┌────────┴───────────┐
                │                    │
          ┌─────▼─────┐        ┌─────▼─────┐
          │   Local   │        │ Cloudflare │
          │Environment│        │Environment │
          └───────────┘        └───────────┘
```

## API Routes

Pom-Bolt exposes several key API endpoints for handling requirements, deployments, and project synchronization:

| Endpoint             | Purpose                                          | Key Components Used                          |
|----------------------|--------------------------------------------------|---------------------------------------------|
| `/api/requirements`  | Processes natural language requirements into code | Requirements Chain, Project State Manager, LLM Integration, Deployment Manager |
| `/api/deploy`        | Deploys generated applications to hosting platforms | Deployment Manager, Project State Manager |
| `/api/sync-projects` | Synchronizes projects between client and server  | Project State Manager, Persistence Layer |
| `/api/projects`      | Retrieves projects from backend storage          | Project State Manager, Persistence Layer |
| `/api/local-zip/:id` | Downloads locally generated application archives | Deployment System (LocalZipTarget) |

## Two Primary Pathways for App Generation

### Pathway 1: Requirements-Driven (Chat/UI Initiated)

1. **Input**: User provides natural language requirements via chat interface
2. **API Trigger**: UI sends requirements to `/api/requirements` endpoint
3. **Requirements Processing**:
   - The middleware chain parses the request and determines if this is a new project or update
   - For existing projects, it loads the project context with current files
   - The LLM processes the requirements into code files
   - The generated files are stored in the project state
4. **Deployment (Optional)**:
   - If deployment is requested, the Deployment Manager selects the best available target
   - Files are packaged and deployed to the selected platform
   - Deployment results are stored in the project state
5. **Response**: The API returns project details and deployment information to the UI

### Pathway 2: Direct Deployment (API Initiated)

1. **Input**: External script or service sends a POST request to `/api/deploy`
2. **API Handling**:
   - The endpoint parses the request for project files or project ID
   - If a project ID is provided, files are loaded from the Project State Manager
   - Deployment credentials are extracted from the request or environment
3. **Deployment**:
   - The Deployment Manager packages files and deploys to the selected target
   - For GitHub/Netlify deployments, additional repository setup may occur
4. **Response**: The API returns deployment details to the caller

## Project Synchronization

Pom-Bolt implements a bidirectional synchronization system to maintain project state across environments:

1. **Background Sync**:
   - On page load, a `BackgroundSync` component initiates synchronization
   - Projects from backend storage are merged with local projects (backend wins on conflicts)
   - Local projects not in backend storage are pushed to the server

2. **Manual Sync**:
   - A UI button allows users to trigger synchronization manually
   - Provides visual feedback on sync status and results

3. **Project Creation Sync**:
   - When a new project is created, it's immediately synchronized to backend storage
   - Ensures project persistence across sessions and devices

## Code Mapping

The following table maps the architectural components to specific code files:

| Component                    | Primary Implementation Files                                                           |
|------------------------------|----------------------------------------------------------------------------------------|
| User Interface Layer         | `app/components/`, `app/routes/`                                                      |
| Project State Management     | `app/lib/projects/state-manager.ts`, `app/lib/projects/persistence/*.ts`              |
| Requirements Chain           | `app/lib/middleware/requirements-chain.ts`                                           |
| Deployment System            | `app/lib/deployment/deployment-manager.ts`, `app/lib/deployment/targets/*.ts`        |
| Environment Abstraction      | `app/lib/environments/base.ts`, `app/lib/environments/detector.ts`                   |
| API Routes                   | `app/routes/api.*.ts`                                                                 |
| Persistence Layer            | `app/lib/kv/binding.ts`, `app/lib/projects/persistence/*.ts`                         |
| LLM Integration              | `app/lib/llm/`, `app/lib/modules/llm/`                                               |
| GitHub Integration           | `app/lib/deployment/github-integration.ts`                                           |
| Project Sync                 | `app/lib/services/project-sync.ts`, `app/components/BackgroundSync.tsx`              |

## Current Implementation Issues and Refactoring Opportunities

Based on the provided documentation, several areas can be improved:

### 1. Integration Issues

- The `additionalRequirement` flag in `/api/requirements` is not properly handled, causing new projects to be created instead of updating existing ones
- Project ID handling is inconsistent between UUID format and custom string formats
- Deployments are not automatically triggered when credentials are provided in the requirements endpoint

### 2. Code Organization

- There are potential circular dependencies in the TypeScript imports
- Environment detection and credential handling have redundant implementations
- The deployment system could benefit from a more unified approach to credential management

### 3. Error Handling

- Project existence checking fails silently for non-UUID project IDs
- Better logging and error reporting is needed throughout the system
- More graceful degradation for missing credentials or failed deployments

### 4. User Experience

- The UI does not fully reflect backend state changes
- Better notification of deployment status and progress is needed
- More consistent project synchronization feedback

## Technology Stack

- **Frontend**: React, TypeScript
- **State Management**: nanostores, localStorage
- **Development Environment**: WebContainer
- **LLM Integration**: AI SDK, provider-specific libraries
- **Persistence**: Cloudflare KV, D1, localStorage
- **Deployment Targets**: Cloudflare Pages, Netlify, GitHub, Local ZIP
- **Backend Runtime**: Cloudflare Workers, Node.js (local)

## Conclusion

Pom-Bolt significantly extends the Bolt.DIY architecture with robust backend capabilities, persistent project state management, and multi-target deployment features. By building on Bolt.DIY's strong foundation of AI-assisted development, Pom-Bolt creates a comprehensive platform for generating, persisting, and deploying applications from natural language requirements.

The architecture's modular design with clear separation of concerns allows for straightforward refactoring and enhancement, while the middleware-based approach to requirements processing provides flexibility and extensibility. The environment abstraction layer ensures consistent behavior across different runtime environments, and the deployment system supports multiple deployment targets through a unified interface. 