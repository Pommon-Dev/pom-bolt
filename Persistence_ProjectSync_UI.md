# Project Synchronization System

This document outlines the bidirectional synchronization system implemented for Pom Bolt, which enables projects to be synchronized between the browser's localStorage and the backend D1 storage.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Feature Components](#feature-components)
4. [Code Map](#code-map)
5. [Data Flow](#data-flow)
6. [User Interface](#user-interface)
7. [Implementation Details](#implementation-details)

## Overview

The Project Synchronization System allows users to create and manage projects across different devices by implementing bidirectional synchronization between the browser's localStorage and Cloudflare's D1 database. This ensures that projects created in the browser are persisted to the cloud and vice versa.

Key capabilities include:
- Automatic background synchronization on page load and at regular intervals
- Manual synchronization through UI controls
- Project creation and updates synchronized in real-time
- Error handling and user feedback through toast notifications

## Architecture

The system follows a client-server architecture with:

- **Backend**: Cloudflare Workers with D1 database and KV storage
- **Frontend**: React components with localStorage for temporary storage
- **Communication**: REST API endpoints for project synchronization

## Feature Components

### 1. Backend API Endpoints

| Endpoint | Function | Description |
|----------|----------|-------------|
| `/api/sync-projects` | `action()` | Receives projects from client and saves to D1/KV |
| `/api/projects` | `loader()` | Returns all projects from backend storage |

### 2. Client Services

| Service | Description |
|---------|-------------|
| `ProjectSyncService` | Manages localStorage operations and sync with backend |
| `ProjectService` | Handles project CRUD operations with integrated sync |

### 3. React Components

| Component | Description |
|-----------|-------------|
| `BackgroundSync` | Silent component for automatic sync on page load |
| `ProjectSyncButton` | UI button for manual sync triggering |
| `Chat.client.tsx` | Integration with chat for project creation |

### 4. React Hooks

| Hook | Description |
|------|-------------|
| `useProjectSync` | Custom hook managing sync state and operations |

## Code Map

### Backend API Integration

```
app/routes/api.sync-projects.ts      - Handles project sync from client to server
app/routes/api.projects.ts           - Returns all projects from backend storage
```

### Client-side Services

```
app/lib/services/project-sync.ts     - Core sync logic for localStorage and backend
app/lib/services/project-service.ts  - Project CRUD operations with integrated sync
```

### UI Components

```
app/components/ProjectSyncButton.tsx - UI button for triggering manual sync
app/components/BackgroundSync.tsx    - Background component for auto-syncing
app/hooks/use-project-sync.ts        - Custom hook for sync operations
```

### Integration Points

```
app/root.tsx                         - Mounts BackgroundSync component
app/components/header/HeaderActionButtons.client.tsx - Displays sync button in header
app/components/chat/Chat.client.tsx  - Syncs chat-created projects
```

## Data Flow

1. **Project Creation Flow**:
   - User creates a project in the UI
   - Project saved to localStorage
   - `ProjectSyncService.syncProject()` sends project to backend
   - `/api/sync-projects` endpoint saves to D1

2. **Project Pull Flow**:
   - Page loads or manual sync triggered
   - `useProjectSync` hook calls `ProjectSyncService.pullFromBackend()`
   - `/api/projects` endpoint returns all backend projects
   - Projects merged with localStorage (backend versions preferred)

3. **Bidirectional Sync Flow**:
   - `syncBidirectional()` executes pull then push
   - Ensures all projects exist in both locations
   - Handles conflict resolution (backend wins)

## User Interface

### Sync Button

The sync button is integrated into the application header, providing:
- Visual indication of sync status
- Tooltip showing last sync time
- Loading animation during sync
- Responsive design (collapses to icon-only on mobile)

### Toast Notifications

The system provides feedback through toast notifications:
- Success messages with counts of synced projects
- Error messages with specific failure reasons
- Silent operation for background syncs

## Implementation Details

### Project Storage Format

Projects are stored with the following structure:
- In localStorage: Map of project ID to `ProjectState` objects
- In backend: Table with serialized `ProjectState` objects

### Sync Logic

The sync process prioritizes:
1. Backend data over local data in case of conflicts
2. Preserving local changes by pushing after pulling
3. Atomic operations to prevent partial updates

### Error Handling

The system implements comprehensive error handling:
- Network failures gracefully degraded
- Detailed error logging
- Retry logic built into the sync process
- User-friendly error messages

### Security Considerations

- Projects are identified by UUID
- Backend endpoints validate request data
- No sensitive data stored in projects

### Performance Optimizations

- Throttled background syncs (every 5 minutes)
- Immediate sync for critical operations (project creation/update)
- Smart merging to minimize data transfer 