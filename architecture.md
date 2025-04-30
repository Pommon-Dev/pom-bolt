# Bolt.DIY Architecture Documentation

## System Overview

Bolt.DIY is a web-based IDE and AI assistant platform designed to help developers create and manage software projects. The application integrates large language models (LLMs) to provide intelligent assistance while coding, offering features like code generation, project scaffolding, and real-time collaboration.

## Core Architecture

### 1. High-Level System Components

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                              │
├───────────┬──────────┬────────────────┬───────────────┬──────────────────┤
│ Workbench │  Editor  │  Preview Panel │   Terminal    │       Chat       │
└───────────┴──────────┴────────────────┴───────────────┴──────────────────┘
               ▲                                               ▲
               │                                               │
               ▼                                               ▼
┌─────────────────────────────────────┐      ┌─-─────────────────────────┐
│      Development Environment        │      │      Core AI System       │
├─────────┬───────────┬──────────────┤       │                           │
│  Files  │ Workspace │   Project    │       │    ┌──────────────────┐   │
│ Manager │  Manager  │   Manager    │       │    │ LLM Integration  │   │
└─────────┴───────────┴──────────────┘       │    └──────────────────┘   │
               ▲                             │             ▲             │
               │                             │             │             │
               │                             │             ▼             │
               │                             │    ┌──────────────────┐   │
               │                             │    │ MCP Servers      │   │
               └─────────────────────────────┼────┼──────────────────┤   │
                                             │    │                  │   │
                                             │    │ ┌────────────┐   │   │
                                             │    │ │    Chat    │   │   │
                                             │    │ │  Manager   │   │   │
                                             │    │ └────────────┘   │   │
                                             │    │                  │   │
                                             │    │ ┌────────────┐   │   │
                                             │    │ │   Prompt   │   │   │
                                             │    │ │  Manager   │   │   │
                                             │    │ └────────────┘   │   │
                                             │    │                  │   │
                                             │    │ ┌────────────┐   │   │
                                             │    │ │  Context   │   │   │
                                             │    │ │  Manager   │   │   │
                                             │    │ └────────────┘   │   │
                                             │    │                  │   │
                                             │    │ ┌────────────┐   │   │
                                             │    │ │  Actions   │   │   │
                                             │    │ │  Manager   │   │   │
                                             │    │ └────────────┘   │   │
                                             │    └──────────────────┘   │
                                             │                           │
                                             │    ┌──────────────────┐   │
                                             │    │ Provider Adapters│   │
                                             │    └──────────────────┘   │
                                             └───────────────────────────┘
```

### 2. Communication Flow

```
┌───────────┐  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐  ┌───────┐
│    User   │  │     Chat    │  │      LLM      │  │    Prompt    │  │     Context    │  │    Actions     │  │  LLM  │
│ Interface │  │   Manager   │  │ Integration   │  │   Manager    │  │    Manager     │  │    Manager     │  │       │
└───────────┘  └─────────────┘  └───────────────┘  └──────────────┘  └────────────────┘  └────────────────┘  └───────┘
      │               │                │                  │                  │                   │                │
      │ Send Message  │                │                  │                  │                   │                │
      │──────────────>│                │                  │                  │                   │                │
      │               │ Provide Chat   │                  │                  │                   │                │
      │               │ History        │                  │                  │                   │                │
      │               │───────────────>│                  │                  │                   │                │
      │               │                │ Request Enhanced │                  │                   │                │
      │               │                │ Prompt           │                  │                   │                │
      │               │                │─────────────────>│                  │                   │                │
      │               │                │                  │                  │                   │                │
      │               │                │ Request Context  │                  │                   │                │
      │               │                │─────────────────────────────────────>                  │                │
      │               │                │                  │                  │                   │                │
      │               │                │ Get Available    │                  │                   │                │
      │               │                │ Tools            │                  │                   │                │
      │               │                │──────────────────────────────────────────────────────────>               │
      │               │                │                  │                  │                   │                │
      │               │                │ Send Enhanced    │                  │                   │                │
      │               │                │ Request          │                  │                   │                │
      │               │                │────────────────────────────────────────────────────────────────────────>│
      │               │                │                  │                  │                   │                │
      │               │                │ Response         │                  │                   │                │
      │               │                │<────────────────────────────────────────────────────────────────────────│
      │               │ Processed      │                  │                  │                   │                │
      │               │ Response       │                  │                  │                   │                │
      │               │<───────────────│                  │                  │                   │                │
      │ Display       │                │                  │                  │                   │                │
      │ Response      │                │                  │                  │                   │                │
      │<──────────────│                │                  │                  │                   │                │
      │               │                │                  │                  │                   │                │
```

### 3. LLM Interaction Flow

```
┌───────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐
│ User  │  │     Chat    │  │    Prompt    │  │     Context    │  │    Actions     │  │      LLM      │
│       │  │   Manager   │  │   Manager    │  │    Manager     │  │    Manager     │  │  Integration  │
└───────┘  └─────────────┘  └──────────────┘  └────────────────┘  └────────────────┘  └───────────────┘
    │             │                │                  │                   │                   │
    │ Send Message│                │                  │                   │                   │
    │────────────>│                │                  │                   │                   │
    │             │ Get Enhanced   │                  │                   │                   │
    │             │ Prompt         │                  │                   │                   │
    │             │───────────────>│                  │                   │                   │
    │             │                │                  │                   │                   │
    │             │ Get Context    │                  │                   │                   │
    │             │─────────────────────────────────>│                   │                   │
    │             │                │                  │                   │                   │
    │             │ Get Available  │                  │                   │                   │
    │             │ Tools          │                  │                   │                   │
    │             │────────────────────────────────────────────────────>│                   │
    │             │                │                  │                   │                   │
    │             │ Send Enhanced  │                  │                   │                   │
    │             │ Request        │                  │                   │                   │
    │             │────────────────────────────────────────────────────────────────────────>│
    │             │                │                  │                   │                   │
    │             │ Response       │                  │                   │                   │
    │             │<────────────────────────────────────────────────────────────────────────│
    │ Display     │                │                  │                   │                   │
    │ Response    │                │                  │                   │                   │
    │<────────────│                │                  │                   │                   │
    │             │                │                  │                   │                   │
```

## Core Components

### 1. User Interface Layer

The UI layer consists of several key components that provide the user-facing functionality of the application:

| Component      | Description                                           | Key Files                                |
|----------------|-------------------------------------------------------|-----------------------------------------|
| Workbench      | Main workspace environment                            | `app/components/workbench/`             |
| Editor         | Code editing interface                                | `app/components/editor/`                |
| Preview Panel  | Renders application previews                          | `app/components/ui/`                    |
| Terminal       | Command-line interface                                | `app/lib/stores/terminal.ts`            |
| Chat Interface | AI assistant chat interface                           | `app/components/chat/`                  |

### 2. Development Environment

The development environment manages the project workspace and file operations:

| Component      | Description                                           | Key Files                                |
|----------------|-------------------------------------------------------|-----------------------------------------|
| Files Manager  | Handles file operations                              | `app/lib/stores/files.ts`                |
| Workspace Manager | Manages workspace state                           | `app/lib/stores/workbench.ts`            |
| Project Manager | Handles project configuration                       | `app/lib/services/importExportService.ts` |

### 3. Core AI System

The AI system integrates with various LLM providers and manages the AI assistant functionality:

| Component        | Description                                         | Key Files                                |
|------------------|-----------------------------------------------------|-----------------------------------------|
| LLM Integration  | Connects to LLM providers                           | `app/lib/modules/llm/`                   |
| Chat Manager     | Manages chat sessions and history                  | `app/components/chat/Chat.client.tsx`, `app/lib/stores/chat.ts` |
| Prompt Manager   | Handles prompt engineering and templates            | `app/lib/common/prompt-library.ts`       |
| Context Manager  | Manages context enrichment for LLM requests         | `app/lib/.server/llm/select-context.ts`   |
| Actions Manager  | Executes actions requested by the LLM               | `app/lib/runtime/action-runner.ts`       |
| Provider Adapters | Adapters for different LLM providers               | `app/lib/modules/llm/providers/`          |

## State Management

The application uses a combination of nanostores and atoms for state management:

| Store           | Description                                           | Key Files                                |
|-----------------|-------------------------------------------------------|-----------------------------------------|
| Workbench Store | Main application state                                | `app/lib/stores/workbench.ts`            |
| Files Store     | File system state                                     | `app/lib/stores/files.ts`                |
| Editor Store    | Editor state                                          | `app/lib/stores/editor.ts`               |
| Chat Store      | Chat state                                            | `app/lib/stores/chat.ts`                 |
| Settings Store  | Application settings                                  | `app/lib/stores/settings.ts`             |

## LLM Integration Architecture

The LLM integration is designed to be modular and extensible, supporting multiple AI providers:

### Provider Registry

The system supports various LLM providers through a registry pattern:

```typescript
// app/lib/modules/llm/registry.ts
import AnthropicProvider from './providers/anthropic';
import CohereProvider from './providers/cohere';
import OpenAIProvider from './providers/openai';
// ... more providers

export {
  AnthropicProvider,
  CohereProvider,
  OpenAIProvider,
  // ... more providers
};
```

### LLM Manager

The LLM Manager handles provider registration and model selection:

```typescript
// app/lib/modules/llm/manager.ts
export class LLMManager {
  private static _instance: LLMManager;
  private _providers: Map<string, BaseProvider> = new Map();
  private _modelList: ModelInfo[] = [];
  private readonly _env: any = {};

  // Singleton implementation
  static getInstance(env: Record<string, string> = {}): LLMManager {
    if (!LLMManager._instance) {
      LLMManager._instance = new LLMManager(env);
    }
    return LLMManager._instance;
  }

  // Provider management methods
  getProvider(name: string): BaseProvider | undefined {
    return this._providers.get(name);
  }
  
  // ... other methods
}
```

### Provider Base Class

All LLM providers extend a base class that defines common functionality:

```typescript
// app/lib/modules/llm/base-provider.ts
export abstract class BaseProvider implements ProviderInfo {
  abstract name: string;
  abstract staticModels: ModelInfo[];
  abstract config: ProviderConfig;
  
  // Methods for provider configuration
  getProviderBaseUrlAndKey(options: {...}) {
    // Implementation
  }
  
  // ... other methods
}
```

## Key Workflows

### 1. Chat Interaction Flow

1. User sends a message through the Chat UI
2. Chat Manager processes the message and sends it to the LLM Integration
3. Prompt Manager enhances the prompt with system instructions
4. Context Manager adds relevant code context
5. Actions Manager provides available tools to the LLM
6. LLM Integration sends the enhanced request to the LLM provider
7. LLM responds with generated text and/or action requests
8. Chat Manager processes the response and displays it to the user

### 2. LLM Provider Integration

1. LLM providers are registered with the LLM Manager
2. Each provider implements the BaseProvider interface
3. The Chat UI allows selecting different models and providers
4. The LLM Manager creates model instances based on selected provider
5. API keys and base URLs are managed securely

### 3. Action Execution

1. LLM generates action requests (file edits, terminal commands)
2. Action Runner receives and processes these requests
3. Actions are executed in the development environment
4. Results are returned to the Chat Manager
5. Chat UI displays the results to the user

## Code Mapping

The following table maps the architectural components to specific code files:

| Component                | Primary Implementation Files                                                           |
|--------------------------|----------------------------------------------------------------------------------------|
| User Interface Layer     | `app/components/`, `app/routes/`                                                      |
| Development Environment  | `app/lib/stores/files.ts`, `app/lib/stores/workbench.ts`                              |
| LLM Integration          | `app/lib/modules/llm/manager.ts`, `app/lib/modules/llm/base-provider.ts`               |
| Chat Manager             | `app/components/chat/Chat.client.tsx`, `app/lib/stores/chat.ts`                       |
| Prompt Manager           | `app/lib/common/prompt-library.ts`, `app/lib/common/prompts/prompts.ts`               |
| Context Manager          | `app/lib/.server/llm/select-context.ts`                                               |
| Actions Manager          | `app/lib/runtime/action-runner.ts`                                                    |
| Provider Adapters        | `app/lib/modules/llm/providers/`                                                      |

## Technology Stack

- **Frontend**: React, TypeScript
- **State Management**: nanostores
- **Development Environment**: WebContainer
- **LLM Integration**: AI SDK, provider-specific libraries
- **Persistence**: IndexedDB, cookies
- **Styling**: SCSS modules, UnoCSS
- **Build Tools**: Vite

## Extension Points

The architecture is designed to be extensible in several key areas:

1. **LLM Providers**: New providers can be added by implementing the BaseProvider interface
2. **System Prompts**: The Prompt Library can be extended with new prompt templates
3. **Action Types**: New action types can be added to the Action Runner
4. **UI Components**: The UI layer can be extended with new components

## Conclusion

The Bolt.DIY architecture is built with modularity and extensibility in mind, allowing for easy integration of new features and LLM providers. The clear separation of concerns between UI, state management, and AI integration makes the codebase maintainable and scalable. 
