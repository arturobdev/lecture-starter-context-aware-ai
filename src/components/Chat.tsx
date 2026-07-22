import { useState, useEffect, useRef } from 'react';
import { db, type Message } from '../db/db.ts';
import { useAppState } from '../state/store.tsx';
import { getLLMService } from '../llm/llm-service.ts';
import { assembleContext, validateUserInput, type ContextConfig } from '../llm/context.ts';
import { embedService } from '../embed/embed-service.ts';
import { initRetriever } from '../embed/retriever.ts';
import {
  processUserMessage,
  processAssistantMessage,
  embedUserMessage,
  setStatsUpdateCallback,
  getMemoryStats,
  deleteMessageFromMemory,
} from '../memory/memory-manager.ts';
import { deleteMessage } from '../db/operations.ts';
import { traceLogger } from '../utils/trace-logger.ts';
import MemoryInspector from './MemoryInspector.tsx';
import { getThreadFacts } from '../llm/facts.ts';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const {
    currentThreadId,
    isOnline,
    modelStatus,
    setModelStatus,
    modelProgress,
    setModelProgress,
    isGenerating,
    setIsGenerating,
    currentStreamedMessage,
    setCurrentStreamedMessage,
    webGPUAvailable,
    lastTokenUsage,
    setLastTokenUsage,
    embedStatus,
    setEmbedStatus,
    embedDevice,
    setEmbedDevice,
    memoryConfig,
    maxInputTokens,
    setMaxInputTokens,
    setMemoryStats,
  } = useAppState();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const llmService = useRef(getLLMService());

  // Set up memory stats callback
  useEffect(() => {
    setStatsUpdateCallback((stats: { messageCount: number; summaryCount: number; factCount: number; embeddingCount: number }) => {
      setMemoryStats(stats);
    });

    // Load initial stats
    getMemoryStats(currentThreadId).then(setMemoryStats);
  }, [currentThreadId, setMemoryStats]);

  // Initialize embedding service and retriever on mount
  useEffect(() => {
    const initEmbeddings = async () => {
      setEmbedStatus('initializing');

      embedService.onStateChange((state) => {
        traceLogger.info('Chat', 'Embedding service state changed', state);

        if (state.status === 'ready') {
          setEmbedStatus('ready');
          setEmbedDevice(state.device || null);
        } else if (state.status === 'error') {
          setEmbedStatus('error');
        } else if (state.status === 'initializing') {
          setEmbedStatus('initializing');
        }
      });

      // Check initial state
      const state = embedService.getState();
      if (state.status === 'ready') {
        setEmbedStatus('ready');
        setEmbedDevice(state.device || null);

        // Initialize retriever when embeddings are ready
        try {
          await initRetriever(currentThreadId);
          traceLogger.info('Chat', 'Retriever initialized');
        } catch (error) {
          traceLogger.error('Chat', 'Failed to initialize retriever', error);
        }
      }
    };

    initEmbeddings();
  }, [currentThreadId, setEmbedStatus, setEmbedDevice]);

  // Initialize model on mount
  useEffect(() => {
    const initModel = async () => {
      if (webGPUAvailable === false) {
        setModelStatus('error');
        return;
      }

      if (webGPUAvailable === true && modelStatus === 'idle') {
        setModelStatus('loading');
        try {
          await llmService.current.initModel('gemma-2-2b-it-q4f16_1-MLC', (progress) => {
            setModelProgress(progress);
          });
          setModelStatus('ready');

          // Get and store token limits from LLM service
          const tokenLimits = llmService.current.getTokenLimits();
          const recommendedInput = tokenLimits?.recommendedInput ?? 2000;
          setMaxInputTokens(recommendedInput);

          traceLogger.info('Chat', 'LLM model initialized successfully', { maxInputTokens: recommendedInput });
        } catch (error) {
          traceLogger.error('Chat', 'Failed to initialize model', error);
          setModelStatus('error');
        }
      }
    };

    initModel();
  }, [webGPUAvailable, modelStatus, setModelStatus, setModelProgress, setMaxInputTokens]);

  // Load messages from Dexie on mount
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const msgs = await db.messages
          .where('threadId')
          .equals(currentThreadId)
          .sortBy('timestamp');
        setMessages(msgs);
        traceLogger.debug('Chat', 'Messages loaded', { count: msgs.length });
      } catch (error) {
        traceLogger.error('Chat', 'Failed to load messages', error);
      }
    };

    loadMessages();
  }, [currentThreadId]);

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamedMessage]);

  const handleSend = async () => {
    if (!input.trim() || modelStatus !== 'ready' || isGenerating) return;
    isSendingRef.current = true;

    // Validate input length using current maxInputTokens from state
    const validationError = validateUserInput(input, maxInputTokens);
    if (validationError) {
      setInputError(validationError);
      return;
    }

    // Clear any previous error
    setInputError(null);

    const userMessage: Message = {
      threadId: currentThreadId,
      role: 'user',
      text: input.trim(),
      timestamp: Date.now(),
    };

    try {
      // Save user message to Dexie
      const userMsgId = await db.messages.add(userMessage);
      const savedUserMsg = await db.messages.get(userMsgId);

      // Update UI with user message
      setMessages((prev) => [...prev, savedUserMsg!]);
      setInput('');
      setIsGenerating(true);
      setCurrentStreamedMessage('');

      // Process user message through memory system
      // This handles: summary generation, retrieval
      const generateSummaryFn = async (prompt: string) => {
        // Use LLM to generate summary (non-streaming)
        // Note: WebLLM requires last message to be user/assistant, not system
        const context = [{ role: 'user' as const, content: prompt }];
        return llmService.current.generateResponse(context, () => { }, () => { });
      };

      const { retrievedSnippets, summary } = await processUserMessage(
        savedUserMsg!,
        currentThreadId,
        maxInputTokens,
        memoryConfig,
        generateSummaryFn
      );

      // Get recent messages and facts for context in parallel
      const [recentMessages, facts] = await Promise.all([
        db.messages.where('threadId').equals(currentThreadId).sortBy('timestamp'),
        getThreadFacts(currentThreadId),
      ]);

      // Assemble context with memory system (summary + retrieval + buffer + facts)
      const contextConfig: ContextConfig = {
        maxInputTokens,
        summary,
        retrievedSnippets,
        facts
      };

      const context = assembleContext(recentMessages, contextConfig);

      // Generate response with streaming
      const fullResponse = await llmService.current.generateResponse(
        context,
        (token) => {
          // Stream tokens to UI
          setCurrentStreamedMessage((prev) => prev + token);
        },
        (usage) => {
          // Update token usage stats
          setLastTokenUsage(usage);
        }
      );

      // Save complete assistant message to Dexie
      const assistantMessage: Message = {
        threadId: currentThreadId,
        role: 'assistant',
        text: fullResponse,
        timestamp: Date.now(),
      };

      const assistantMsgId = await db.messages.add(assistantMessage);
      const savedAssistantMsg = await db.messages.get(assistantMsgId);

      // Update UI with complete message
      setMessages((prev) => [...prev, savedAssistantMsg!]);
      setCurrentStreamedMessage('');
      setIsGenerating(false);

      // Process messages through memory system asynchronously (don't block UI)
      if (embedStatus === 'ready' && userMsgId !== undefined && assistantMsgId !== undefined) {
        processMemoryAsync(savedUserMsg!, savedAssistantMsg!, generateSummaryFn);
      }
    } catch (error) {
      traceLogger.error('Chat', 'Failed to generate response', error);
      setIsGenerating(false);
      setCurrentStreamedMessage('');
    } finally {
      isSendingRef.current = false;
    }
  };

  // Process memory asynchronously (embedding + fact extraction)
  const processMemoryAsync = async (
    userMsg: Message,
    assistantMsg: Message,
    generateFn: (prompt: string) => Promise<string>
  ) => {
    try {
      setEmbedStatus('embedding');
      traceLogger.info('Chat', 'Starting memory processing');

      // Embed user message
      await embedUserMessage(userMsg, currentThreadId);

      // Process assistant message (embed + extract facts)
      await processAssistantMessage(assistantMsg, currentThreadId, memoryConfig, generateFn);

      setEmbedStatus('ready');
      traceLogger.info('Chat', 'Memory processing completed');
    } catch (error) {
      traceLogger.error('Chat', 'Failed to process memory', error);
      setEmbedStatus('ready'); // Reset to ready even on error
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    llmService.current.stopGeneration();
    setIsGenerating(false);
    setCurrentStreamedMessage('');
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!msgId || isGenerating) return;

    if (!confirm('Delete this message? (Assistant response will also be removed)')) {
      return;
    }

    try {
      // Delete from database (also deletes embeddings, facts, and follow-up assistant message)
      await deleteMessage(msgId);

      // Update memory system (rebuild ANN index)
      await deleteMessageFromMemory(msgId, currentThreadId);

      // Reload messages from database
      const msgs = await db.messages
        .where('threadId')
        .equals(currentThreadId)
        .sortBy('timestamp');
      setMessages(msgs);

      traceLogger.info('Chat', 'Message deleted', { msgId });
    } catch (error) {
      traceLogger.error('Chat', 'Failed to delete message', error);
      alert('Failed to delete message. Check console for details.');
    }
  };

  // Show WebGPU error
  if (webGPUAvailable === false) {
    return (
      <div className="chat-container">
        <div className="error-message">
          <h2>⚠️ WebGPU Not Available</h2>
          <p>
            This app requires WebGPU support to run. Please use Chrome 113+ or Edge 113+ with WebGPU
            enabled.
          </p>
          <p>
            <a
              href="https://developer.chrome.com/docs/web-platform/webgpu"
              target="_blank"
              rel="noopener noreferrer"
            >
              Learn more about WebGPU
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="chat-container">
        <div className="chat-header">
          <h1>OffChat</h1>
          <div className="header-status">
            <div className="status-badge" data-online={isOnline}>
              {isOnline ? '🌐 Online' : '📡 Offline'}
            </div>
            <div className="model-status" data-status={modelStatus}>
              {modelStatus === 'loading' &&
                `⏳ Loading: ${modelProgress.text} (${Math.round(modelProgress.progress * 100)}%)`}
              {modelStatus === 'ready' && '✅ Model Ready'}
              {modelStatus === 'error' && '❌ Model Error'}
            </div>
            {lastTokenUsage && (
              <div className="token-usage">
                📊 {lastTokenUsage.promptTokens} in / {lastTokenUsage.completionTokens} out (
                {lastTokenUsage.totalTokens} total)
              </div>
            )}
            <div className="model-status" data-status={embedStatus}>
              {embedStatus === 'initializing' && '🔄 Embeddings: Initializing...'}
              {embedStatus === 'ready' && `✅ Embeddings: Ready (${embedDevice || 'unknown'})`}
              {embedStatus === 'embedding' && '🔄 Embeddings: Processing...'}
              {embedStatus === 'error' && '❌ Embeddings: Error'}
            </div>
          </div>
        </div>

        <div className="messages-list">
          {messages.map((msg, idx) => (
            <div key={msg.id || idx} className={`message message-${msg.role}`}>
              <div className="message-header">
                <div className="message-role">{msg.role}</div>
                {msg.role === 'user' && msg.id && !isGenerating && (
                  <button
                    onClick={() => handleDeleteMessage(msg.id!)}
                    className="delete-button"
                    title="Delete message and response"
                  >
                    🗑️
                  </button>
                )}
              </div>
              <div className="message-text">{msg.text}</div>
              <div className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
          {/* Show streaming message */}
          {isGenerating && currentStreamedMessage && (
            <div className="message message-assistant streaming">
              <div className="message-role">assistant</div>
              <div className="message-text">{currentStreamedMessage}</div>
              <div className="message-time">streaming...</div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setInputError(null); // Clear error on input change
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              modelStatus === 'ready'
                ? 'Type your message... Enter to send, Shift+Enter for new line'
                : 'Waiting for model to load...'
            }
            rows={3}
            disabled={modelStatus !== 'ready' || isGenerating}
            className={inputError ? 'input-error' : ''}
          />
          {inputError && <div className="error-text">{inputError}</div>}
          <div className="input-buttons">
            {isGenerating ? (
              <button onClick={handleStop} className="stop-button">
                Stop
              </button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim() || modelStatus !== 'ready'}>
                Send
              </button>
            )}
          </div>
        </div>
      </div>
      <MemoryInspector />
    </>
  );
}
