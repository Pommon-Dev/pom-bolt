/*
 * @ts-nocheck
 * Preventing TS checks with files presented in the video for a better presentation.
 */
import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from 'ai/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cssTransition, toast, ToastContainer } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts, useSnapScroll } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { ChatWithFileUpload } from './ChatWithFileUpload';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { ProjectService } from '~/lib/services/project-service';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const {
    ready,
    initialMessages,
    initialRequirements,
    hasInitialRequirements,
    storeMessageHistory,
    importChat,
    exportChat,
  } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  // Effect to sync chat messages with project requirements
  useEffect(() => {
    if (!ready || initialMessages.length === 0) return;

    const syncRequirementsToProject = async () => {
      try {
        // Get the current project ID from the URL if available
        const currentPath = window.location.pathname;
        const projectId = currentPath.startsWith('/chat/') ? currentPath.split('/')[2] : null;
        
        if (!projectId) return;
        
        logger.debug('Syncing chat messages to project', { projectId, messageCount: initialMessages.length });
        
        // Get user messages to use as requirements
        const userMessages = initialMessages.filter(m => m.role === 'user' && !m.annotations?.includes('hidden'));
        
        if (userMessages.length === 0) return;
        
        // Create or update the project
        const existingProject = ProjectService.getProject(projectId);
        
        if (existingProject) {
          // If project exists, just make sure it's synced
          logger.info('Ensuring project is synced with backend', { projectId });
          // No need to update content, just ensure sync
          await ProjectService.updateProject(projectId, { 
            name: title || existingProject.name
          });
        } else {
          // Create new project with this ID and the first user message as requirements
          const firstUserMessage = userMessages[0];
          const content = typeof firstUserMessage.content === 'string' 
            ? firstUserMessage.content 
            : JSON.stringify(firstUserMessage.content);
            
          logger.info('Creating new project from chat', { projectId });
          
          await ProjectService.createProject({
            id: projectId,
            name: title || 'Chat Project',
            requirements: content
          });
        }
      } catch (error) {
        logger.error('Failed to sync chat to project', error);
        // Don't show toast to user - this is a background sync
      }
    };
    
    syncRequirementsToProject();
  }, [ready, initialMessages, title]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          initialRequirements={typeof initialRequirements === 'string' ? initialRequirements : undefined}
          hasInitialRequirements={!!hasInitialRequirements && typeof initialRequirements === 'string'}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          /**
           * @todo Handle more types if we need them. This may require extra color palettes.
           */
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
      />
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  initialRequirements?: string;
  hasInitialRequirements?: boolean;
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({
    description,
    initialMessages,
    initialRequirements,
    hasInitialRequirements,
    storeMessageHistory,
    importChat,
    exportChat,
  }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const files = useStore(workbenchStore.files);
    const actionAlert = useStore(workbenchStore.alert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();

    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });

    const { showChat } = useStore(chatStore);

    const [animationScope, animate] = useAnimate();

    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        logger.error('Request failed\n\n', e, error);
        logStore.logError('Chat request failed', e, {
          component: 'Chat',
          action: 'request',
          error: e.message,
        });
        toast.error(
          'There was an error processing your request: ' + (e.message ? e.message : 'No details were returned'),
        );
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
            },
          ] as any, // Type assertion to bypass compiler check
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string, projectId?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      // Get the current project ID from the URL if available
      const currentPath = window.location.pathname;
      const currentProjectId = currentPath.startsWith('/chat/') ? currentPath.split('/')[2] : null;

      // Check if this is a webhook-initiated request by looking at the event properties
      const isWebhookRequest = Object.keys(_event).length === 0;

      // If a specific projectId is provided
      if (projectId) {
        logger.info('Project ID detected in request', { projectId, isWebhookRequest });

        if (currentProjectId !== projectId) {
          logger.info('Navigating to project page', {
            from: currentProjectId || 'home',
            to: projectId,
          });

          /*
           * Navigate to the project page and pass the requirements
           * Use window.location.replace to avoid adding to browser history
           * This prevents the issue of navigating back to home page after redirect
           */
          window.location.replace(`/chat/${projectId}?initialRequirements=${encodeURIComponent(messageContent)}`);

          return;
        }

        logger.info('Already on correct project page, processing requirements', { projectId });
      } else if (isWebhookRequest && currentProjectId) {
        /*
         * No projectId provided but this is a webhook request and we're on a project page
         * We should navigate to the home page to create a new project
         */
        logger.info('Webhook request without project ID on project page. Navigating to home page for new project.', {
          from: currentProjectId,
        });

        // Display a toast to inform the user about redirecting
        toast('Creating a new project from your requirements...', {
          type: 'info',
        });

        /*
         * Navigate to the home page with a special flag to indicate this is from a webhook
         * This helps with handling the animation and UI state on the home page
         */
        window.location.replace(`/?initialRequirements=${encodeURIComponent(messageContent)}&fromWebhook=true`);

        return;
      } else {
        // Normal user input or webhook on home page - create a new project
        logger.info('Processing as new project or regular chat input', {
          currentLocation: currentProjectId ? `project/${currentProjectId}` : 'home',
          isWebhookRequest,
        });
      }

      runAnimation();

      if (!chatStarted) {
        // const [fakeLoading, setFakeLoading] = useState(false); // TODO: Will be used for loading states

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: messageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: messageContent,
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);
              reload();

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: [
              {
                type: 'text',
                text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
              },
              ...imageDataList.map((imageData) => ({
                type: 'image',
                image: imageData,
              })),
            ] as any,
          },
        ]);
        reload();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${messageContent}`,
            },
            ...imageDataList.map((imageData) => ({
              type: 'image',
              image: imageData,
            })),
          ] as any,
        });

        workbenchStore.resetAllFileModifications();
      } else {
        append({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
            },
            ...imageDataList.map((imageData) => ({
              type: 'image',
              image: imageData,
            })),
          ] as any,
        });
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();

      // Clear the URL parameter to prevent duplication on page refresh
      const url = new URL(window.location.href);
      url.searchParams.delete('initialRequirements');
      window.history.replaceState({}, '', url);
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const [messageRef, scrollRef] = useSnapScroll();

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const processedMessages = messages.map((message, i) => ({
      ...message,
      content: parsedMessages[i] || message.content,
    }));

    // Add effect to process initialRequirements when the component is loaded
    useEffect(() => {
      // Process initial requirements if they exist
      if (hasInitialRequirements && initialRequirements) {
        logger.info('Processing initial requirements from URL', {
          length: initialRequirements.length,
          chatStarted,
        });

        // Force start the chat if it's not already started but we have initial requirements
        if (!chatStarted) {
          setChatStarted(true);
          chatStore.setKey('started', true);
          logger.info('Force starting chat for initial requirements');
        }

        // Use a larger timeout to ensure the chat UI is fully ready before processing
        setTimeout(() => {
          const messageContent = initialRequirements;
          logger.info('Processing initialRequirements directly', {
            length: messageContent.length,
            chatStarted: chatStarted || true, // Will be true after the force start above
          });

          // If not already started, we need to trigger the animation
          if (!document.querySelector('.animate-fade-in')) {
            runAnimation().catch((error) => {
              logger.error('Failed to run animation', { error });
            });
          }

          // For a new project (or if chat was force-started), use setMessages
          if (!initialMessages.length) {
            logger.info('Setting initial message for new project');
            setMessages([
              {
                id: `${new Date().getTime()}`,
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
                  },
                ] as any,
              },
            ]);
            reload();
          } else {
            // For existing projects with chat already started, use append
            logger.info('Appending message to existing chat');

            if (error != null) {
              setMessages(messages.slice(0, -1));
            }

            append({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${messageContent}`,
                },
              ] as any,
            });
          }

          // Clear the URL parameter to prevent duplication on page refresh
          const url = new URL(window.location.href);
          url.searchParams.delete('initialRequirements');
          window.history.replaceState({}, '', url);
        }, 1500); // Increased timeout for better reliability
      }
    }, [initialRequirements, hasInitialRequirements, model, provider, initialMessages.length]);

    return (
      <div ref={animationScope} className="flex flex-col h-full">
        <ChatWithFileUpload
          textareaRef={textareaRef}
          messageRef={messageRef}
          scrollRef={scrollRef}
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={isLoading}
          onStreamingChange={(streaming: boolean) => {
            streamingState.set(streaming);
          }}
          messages={processedMessages}
          description={description}
          enhancingPrompt={enhancingPrompt}
          promptEnhanced={promptEnhanced}
          input={input}
          model={model}
          setModel={handleModelChange}
          provider={provider}
          setProvider={handleProviderChange}
          providerList={activeProviders}
          handleStop={abort}
          sendMessage={sendMessage}
          handleInputChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            onTextareaChange(e);
            debouncedCachePrompt(e);
          }}
          enhancePrompt={(input) => {
            enhancePrompt(
              input,
              (input) => {
                setInput(input);
                scrollTextArea();
              },
              model,
              provider,
              apiKeys,
            );
          }}
          importChat={importChat}
          exportChat={exportChat}
          uploadedFiles={uploadedFiles}
          setUploadedFiles={setUploadedFiles}
          imageDataList={imageDataList}
          setImageDataList={setImageDataList}
          actionAlert={actionAlert}
          clearAlert={() => workbenchStore.clearAlert()}
          data={chatData}
        />
      </div>
    );
  },
);
