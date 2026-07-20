/**
 * Memory Manager Service
 *
 * Orchestrates the complete memory system:
 * - Rolling summary generation
 * - Fact extraction
 * - Semantic retrieval
 * - Token budget management
 */

import { db, type Message } from '../db/db';
import { checkNeedsSummary, updateRollingSummary, getLatestSummary } from '../llm/summary';
import { extractAndSaveFacts } from '../llm/facts';
import { retrieveRelevant, type RetrievalConfig, type RetrievalResult, removeEmbedding } from '../embed/retriever';
import { addEmbedding } from '../embed/retriever';
import { embedService } from '../embed/embed-service';
import { calculateTokenBudget } from '../utils/tokens';
import { traceLogger } from '../utils/trace-logger';

/**
 * Memory system configuration
 */
export interface MemoryConfig {
  // Retrieval settings
  retrievalK: number; // Number of snippets to retrieve (default: 5)
  useRecencyBoost: boolean; // Apply recency boost (default: true)
  recencyAlpha: number; // Semantic weight (default: 0.7)
  recencyBeta: number; // Recency weight (default: 0.3)
  useMMR: boolean; // Use MMR for diversity (default: false)
  mmrLambda: number; // MMR tradeoff (default: 0.7)

  // Summary settings
  autoSummarize: boolean; // Auto-generate summaries (default: true)

  // Fact extraction settings
  autoExtractFacts: boolean; // Auto-extract facts (default: true)
}

/**
 * Default memory configuration
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  retrievalK: 5,
  useRecencyBoost: true,
  recencyAlpha: 0.7,
  recencyBeta: 0.3,
  useMMR: false,
  mmrLambda: 0.7,
  autoSummarize: true,
  autoExtractFacts: true,
};

/**
 * Memory manager state
 */
interface MemoryState {
  isProcessing: boolean;
  lastRetrievalResults: RetrievalResult[];
}

const state: MemoryState = {
  isProcessing: false,
  lastRetrievalResults: [],
};

/**
 * Process a new user message through the memory system
 * Returns retrieved context for LLM generation
 */
export async function processUserMessage(
  userMessage: Message,
  threadId: string,
  maxInputTokens: number,
  config: MemoryConfig,
  generateFn: (prompt: string) => Promise<string>
): Promise<{
  retrievedSnippets: RetrievalResult[];
  summary: Awaited<ReturnType<typeof getLatestSummary>>;
}> {
  try {
    traceLogger.info('MemoryManager', 'Processing user message', {
      msgId: userMessage.id,
      threadId,
    });

    // Check if we need to generate a summary
    if (config.autoSummarize) {
      const budget = calculateTokenBudget(maxInputTokens);
      const needsSummary = await checkNeedsSummary(threadId, budget.buffer);

      if (needsSummary) {
        traceLogger.info('MemoryManager', 'Triggering summary generation');
        await updateRollingSummary(threadId, budget.buffer, generateFn);
      }
    }

    // Get latest summary
    const summary = await getLatestSummary(threadId);

    // Retrieve relevant snippets for this query
    const retrievalConfig: RetrievalConfig = {
      k: config.retrievalK,
      threadId,
      useRecencyBoost: config.useRecencyBoost,
      recencyAlpha: config.recencyAlpha,
      recencyBeta: config.recencyBeta,
      useMMR: config.useMMR,
      mmrLambda: config.mmrLambda,
    };

    const retrievedSnippets = await retrieveRelevant(userMessage.text, retrievalConfig);
    state.lastRetrievalResults = retrievedSnippets;

    traceLogger.info('MemoryManager', 'User message processed', {
      summaryExists: !!summary,
      retrievedCount: retrievedSnippets.length,
    });

    return {
      retrievedSnippets,
      summary,
    };
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to process user message', error);
    return {
      retrievedSnippets: [],
      summary: null,
    };
  }
}

/**
 * Process assistant response after generation
 * Handles embedding and fact extraction
 */
export async function processAssistantMessage(
  assistantMessage: Message,
  threadId: string,
  config: MemoryConfig,
  generateFn: (prompt: string) => Promise<string>
): Promise<void> {
  if (state.isProcessing) {
    traceLogger.warn('MemoryManager', 'Already processing, skipping');
    return;
  }

  try {
    state.isProcessing = true;

    traceLogger.info('MemoryManager', 'Processing assistant message', {
      msgId: assistantMessage.id,
      threadId,
    });

    // Embed the assistant message
    if (assistantMessage.id) {
      const embedResult = await embedService.embedText(assistantMessage.text);
      await addEmbedding(assistantMessage.id, embedResult.embedding, threadId);
      traceLogger.info('MemoryManager', 'Assistant message embedded');
    }

    // Extract facts if enabled
    if (config.autoExtractFacts && assistantMessage.id) {
      const factCount = await extractAndSaveFacts(assistantMessage, generateFn);
      traceLogger.info('MemoryManager', 'Facts extracted', { count: factCount });
    }

    traceLogger.info('MemoryManager', 'Assistant message processed');

    // Notify stats update
    await notifyStatsUpdate(threadId);
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to process assistant message', error);
  } finally {
    state.isProcessing = false;
  }
}

/**
 * Process user message embedding (called after message is saved)
 */
export async function embedUserMessage(
  userMessage: Message,
  threadId: string
): Promise<void> {
  try {
    if (!userMessage.id) {
      traceLogger.warn('MemoryManager', 'Cannot embed message without ID');
      return;
    }

    traceLogger.info('MemoryManager', 'Embedding user message', {
      msgId: userMessage.id,
    });

    const embedResult = await embedService.embedText(userMessage.text);
    await addEmbedding(userMessage.id, embedResult.embedding, threadId);

    traceLogger.info('MemoryManager', 'User message embedded');

    // Notify stats update
    await notifyStatsUpdate(threadId);
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to embed user message', error);
  }
}

/**
 * Get last retrieval results (for display in Memory Inspector)
 */
export function getLastRetrievalResults(): RetrievalResult[] {
  return state.lastRetrievalResults;
}

/**
 * Rebuild entire memory system for a thread
 * Useful for recovery from corruption or manual reset
 */
export async function rebuildMemorySystem(
  threadId: string,
  generateFn: (prompt: string) => Promise<string>
): Promise<void> {
  try {
    traceLogger.info('MemoryManager', 'Rebuilding memory system', { threadId });

    // Import rebuildIndex from retriever
    const { rebuildIndex } = await import('../embed/retriever');

    // Rebuild embeddings index
    await rebuildIndex(threadId);

    // Rebuild summary (deleted and regenerated in rebuildSummary)
    const { rebuildSummary } = await import('../llm/summary');
    await rebuildSummary(threadId, generateFn);

    // Note: Facts are tied to source messages and don't need rebuilding
    // They can be manually deleted if needed

    traceLogger.info('MemoryManager', 'Memory system rebuilt successfully');
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to rebuild memory system', error);
    throw error;
  }
}

/**
 * Get memory statistics for display
 */
export async function getMemoryStats(threadId: string): Promise<{
  messageCount: number;
  summaryCount: number;
  factCount: number;
  embeddingCount: number;
}> {
  try {
    const [messageCount, summaryCount, factCount, embeddingCount] = await Promise.all([
      db.messages.where('threadId').equals(threadId).count(),
      db.summaries.where('threadId').equals(threadId).count(),
      db.facts.where('threadId').equals(threadId).count(),
      db.embeddings.where('threadId').equals(threadId).count(),
    ]);

    return {
      messageCount,
      summaryCount,
      factCount,
      embeddingCount,
    };
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to get memory stats', error);
    return {
      messageCount: 0,
      summaryCount: 0,
      factCount: 0,
      embeddingCount: 0,
    };
  }
}

/**
 * Update memory stats callback (set from Chat component)
 */
let updateStatsCallback: ((stats: Awaited<ReturnType<typeof getMemoryStats>>) => void) | null = null;

export function setStatsUpdateCallback(callback: typeof updateStatsCallback) {
  updateStatsCallback = callback;
}

async function notifyStatsUpdate(threadId: string) {
  if (updateStatsCallback) {
    const stats = await getMemoryStats(threadId);
    updateStatsCallback(stats);
  }
}

/**
 * Delete a message and update memory system
 */
export async function deleteMessageFromMemory(
  messageId: number,
  threadId: string
): Promise<void> {
  try {
    traceLogger.info('MemoryManager', 'Deleting message from memory', { messageId });

    // Remove embedding from index
    await removeEmbedding(messageId, threadId);

    traceLogger.info('MemoryManager', 'Message deleted from memory');

    // Notify stats update
    await notifyStatsUpdate(threadId);
  } catch (error) {
    traceLogger.error('MemoryManager', 'Failed to delete message from memory', error);
    throw error;
  }
}
