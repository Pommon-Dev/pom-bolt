import { createScopedLogger } from '~/utils/logger';
import { LLMManager } from '~/lib/modules/llm/manager';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import type { ModelInfo } from '~/lib/modules/llm/types';

// Define a constant for max tokens directly instead of importing from server-only module
const MAX_TOKENS = 16000;

const logger = createScopedLogger('codegen-service');

export interface CodegenOptions {
  requirements: string;
  existingFiles?: Record<string, string>;
  projectId: string;
  isNewProject: boolean;
  userId?: string;
  serverEnv?: Record<string, any>;
  apiKeys?: Record<string, string>;
  providerSettings?: Record<string, any>;
}

export interface CodegenResult {
  files: Record<string, string>;
  metadata: Record<string, any>;
}

/**
 * Service responsible for code generation based on requirements
 */
export class CodegenService {
  /**
   * Generate code from requirements using the LLM
   */
  static async generateCode(options: CodegenOptions): Promise<CodegenResult> {
    const {
      requirements,
      existingFiles = {},
      projectId,
      isNewProject,
      serverEnv,
      apiKeys,
      providerSettings
    } = options;

    try {
      logger.info('Starting code generation', { 
        projectId, 
        isNewProject, 
        requirementsLength: requirements.length,
        existingFilesCount: Object.keys(existingFiles).length
      });

      logger.debug('Environment details for code generation:', {
        hasServerEnv: !!serverEnv,
        envType: typeof serverEnv,
        hasApiKeys: !!apiKeys,
        hasProviderSettings: !!providerSettings,
        isCloudflareEnv: serverEnv && (
          (serverEnv as any).CF_PAGES === '1' || 
          (serverEnv as any).env?.CF_PAGES === '1'
        )
      });

      // Create context for the LLM
      const systemMessage = this.createSystemMessage(isNewProject);
      const userMessage = this.createUserMessage(requirements, existingFiles, isNewProject);

      // Default result as undefined, will be filled by LLM or fallback
      let result: { text: string; } | undefined = undefined;
      
      // Define modelInfo at this scope so it's available throughout the function
      let modelInfo: ModelInfo | undefined;
      
      try {
        // Get the LLM manager
        const llmManager = LLMManager.getInstance();
        
        // Ensure LLM manager has access to environment variables
        if (serverEnv) {
          llmManager.setEnv(serverEnv);
          logger.debug('Set environment variables in LLM manager');
        }
        
        let modelInstance: any;
        let providerInfo;
        
        try {
          // Try to get available models from LLM manager
          const models = await llmManager.getModelList();
          
          // First check if we have models available
          if (models && models.length > 0) {
            // Get the default preferred provider from environment variables
            // For Cloudflare, prioritize OpenAI since that's what we have configured
            const preferredProvider = serverEnv?.DEFAULT_LLM_PROVIDER || 'openai';
            const preferredModel = serverEnv?.DEFAULT_LLM_MODEL || 'gpt-4o-mini';
            
            logger.debug(`Looking for preferred provider: ${preferredProvider}, model: ${preferredModel}`);
            
            // Given we're having issues with OpenAI in Cloudflare, let's try it first
            modelInfo = models.find(m => 
              m.provider.toLowerCase() === 'openai'
            );
            
            if (modelInfo) {
              logger.info(`Found OpenAI model: ${modelInfo.name}`);
            } else {
              // First try to find the exact preferred model
              modelInfo = models.find(m => 
                m.provider.toLowerCase() === preferredProvider.toLowerCase() && 
                m.name.toLowerCase() === preferredModel.toLowerCase()
              );
              
              // If not found, try any model from the preferred provider
              if (!modelInfo) {
                modelInfo = models.find(m => 
                  m.provider.toLowerCase() === preferredProvider.toLowerCase()
                );
              }
              
              // Last resort, use any available model
              if (!modelInfo) {
                logger.info(`No preferred models available, using first available model: ${models[0].name} from ${models[0].provider}`);
                modelInfo = models[0];
              }
            }
            
            // Get the provider for the selected model
            providerInfo = PROVIDER_LIST.find(p => 
              p.name.toLowerCase() === (modelInfo?.provider || '').toLowerCase()
            );
            
            if (providerInfo && modelInfo) {
              logger.info(`Using model ${modelInfo.name} from provider ${modelInfo.provider} for code generation`);
              
              // Get model instance from the provider
              const provider = llmManager.getProvider(modelInfo.provider);
              if (provider) {
                try {
                  // Add direct API key mapping for OpenAI if it exists in the environment
                  // This ensures we handle Cloudflare environment properly
                  let updatedApiKeys = apiKeys || {};
                  
                  // For Cloudflare environment with OpenAI key, add it directly to apiKeys
                  if (serverEnv?.OPENAI_API_KEY && provider.name === 'OpenAI') {
                    updatedApiKeys = { 
                      ...updatedApiKeys, 
                      OpenAI: serverEnv.OPENAI_API_KEY 
                    };
                    logger.debug('Added OPENAI_API_KEY directly from environment to apiKeys');
                  }
                  
                  modelInstance = provider.getModelInstance({
                    model: modelInfo.name,
                    serverEnv: serverEnv as any,
                    apiKeys: updatedApiKeys,
                    providerSettings
                  });
                  
                  // Generate the code using the model
                  if (modelInstance) {
                    result = await generateText({
                      system: systemMessage,
                      messages: [
                        {
                          role: 'user',
                          content: userMessage,
                        },
                      ],
                      model: modelInstance,
                      maxTokens: modelInfo && modelInfo.maxTokenAllowed ? modelInfo.maxTokenAllowed : MAX_TOKENS,
                    });
                    
                    logger.info('Code generation with LLM completed successfully');
                  } else {
                    logger.warn(`Failed to get model instance for ${modelInfo.name}`);
                  }
                } catch (error) {
                  logger.error('Error during model instance creation or text generation:', error);
                  // Continue to fallback
                }
              }
            }
          } else {
            logger.warn('No models available, will use static fallback');
          }
        } catch (modelError) {
          logger.warn('Error using model, will fallback to static generation:', modelError);
        }
      } catch (llmError) {
        logger.warn('Error initializing LLM manager, will fallback to static generation:', llmError);
      }
      
      // If no result was generated, use the static fallback
      if (!result) {
        logger.info('Using static fallback for code generation');
        result = {
          text: this.getStaticFallbackCode(requirements),
        };
        
        // Clear modelInfo since we're using the fallback
        modelInfo = undefined;
      }

      // Parse the generated code to extract files
      const files = this.parseGeneratedCode(result.text, existingFiles);

      logger.info(`Extracted ${Object.keys(files).length} files from generated code`);

      // Create metadata with safe access to modelInfo
      const metadata = {
        model: modelInfo?.name || 'static-fallback',
        provider: modelInfo?.provider || 'Fallback',
        timestamp: Date.now()
      };

      return {
        files,
        metadata
      };
    } catch (error) {
      logger.error('Error generating code:', error);
      
      // Always return a valid result with the static code
      logger.info('Using emergency fallback due to error');
      return {
        files: this.parseGeneratedCode(this.getStaticFallbackCode(requirements), existingFiles),
        metadata: {
          model: 'emergency-fallback',
          provider: 'Fallback',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Create system message for code generation
   */
  private static createSystemMessage(isNewProject: boolean): string {
    if (isNewProject) {
      return `You are an expert software developer tasked with creating a complete application from requirements.
Please follow these guidelines:
1. Generate all necessary files for a complete, working application
2. Use modern best practices and follow a clean architecture
3. Include proper error handling and documentation
4. Files should be complete and ready to deploy without additional modifications
5. Include HTML, CSS, JavaScript/TypeScript, and any other files needed
6. Provide code that works out-of-the-box for deployment to web hosting
7. Structure your response with clear file sections using \`\`\`filename.ext\n[code]\`\`\` format
8. Begin each file with \`\`\`filename.ext\n and end with \`\`\`

You should ONLY respond with the code files, do not include any explanation, commentary, or instructions outside of code blocks.`;
    } else {
      return `You are an expert software developer tasked with updating an existing application based on new requirements.
Please follow these guidelines:
1. Analyze the existing files carefully and maintain code style and architecture
2. Only modify or create files as needed to fulfill the new requirements
3. Preserve existing functionality while adding the requested features
4. Include proper error handling and documentation for new code
5. The modified/new files should be compatible with the existing codebase
6. Structure your response with clear file sections using \`\`\`filename.ext\n[code]\`\`\` format
7. Begin each file with \`\`\`filename.ext\n and end with \`\`\`

You should ONLY respond with the code files, do not include any explanation, commentary, or instructions outside of code blocks.`;
    }
  }

  /**
   * Create user message with requirements and context
   */
  private static createUserMessage(
    requirements: string, 
    existingFiles: Record<string, string>,
    isNewProject: boolean
  ): string {
    if (isNewProject) {
      return `Create a complete web application based on these requirements:

${requirements}

Please generate all necessary files for deployment.`;
    } else {
      // Format existing files for context
      const existingFilesContext = Object.entries(existingFiles)
        .map(([filename, content]) => `\`\`\`${filename}\n${content}\n\`\`\``)
        .join('\n\n');

      return `I need to update an existing application to meet these new requirements:

${requirements}

Here are the current files:

${existingFilesContext}

Please provide the modified files and any new files needed.`;
    }
  }

  /**
   * Parse the LLM response to extract generated files
   */
  private static parseGeneratedCode(generatedText: string, existingFiles: Record<string, string>): Record<string, string> {
    const files: Record<string, string> = {};
    
    // Start with existing files as a base for updates
    Object.assign(files, existingFiles);
    
    // Match file blocks in the format ```filename.ext\n...```
    const fileBlockRegex = /```(.*?)\n([\s\S]*?)```/g;
    let match;
    
    while ((match = fileBlockRegex.exec(generatedText)) !== null) {
      const filename = match[1].trim();
      const content = match[2];
      
      // Validate filename
      if (filename && !filename.includes('output') && !filename.includes('Output')) {
        files[filename] = content;
      }
    }
    
    return files;
  }

  /**
   * Get static fallback code when LLMs are unavailable
   */
  private static getStaticFallbackCode(requirements: string): string {
    logger.info('Generating static sample project with requirements:', requirements);
    
    // Generate a basic React app as a fallback
    return `
\`\`\`package.json
{
  "name": "simple-react-app",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "scripts": {
    "start": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
}
\`\`\`

\`\`\`index.html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
\`\`\`

\`\`\`src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
\`\`\`

\`\`\`src/App.jsx
import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="App">
      <header className="App-header">
        <h1>Simple React App</h1>
        <p>This is a sample React application generated automatically.</p>
        <div className="card">
          <button onClick={() => setCount((count) => count + 1)}>
            Count is {count}
          </button>
        </div>
      </header>
    </div>
  )
}

export default App
\`\`\`

\`\`\`src/index.css
:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}
\`\`\`

\`\`\`src/App.css
.App {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.App-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: calc(10px + 2vmin);
}

.card {
  padding: 2em;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}

button:hover {
  border-color: #646cff;
}

button:focus,
button:focus-visible {
  outline: 4px auto -webkit-focus-ring-color;
}
\`\`\`

\`\`\`vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
\`\`\`

\`\`\`README.md
# Simple React App

This is a basic React application created as a sample project. 

## Getting Started

1. Install dependencies:
   \`\`\`
   npm install
   \`\`\`

2. Start the development server:
   \`\`\`
   npm start
   \`\`\`

3. Build for production:
   \`\`\`
   npm run build
   \`\`\`
\`\`\`
`;
  }
} 