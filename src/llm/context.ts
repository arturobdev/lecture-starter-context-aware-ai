import { type Message, type Summary } from '../db/db';
import { SYSTEM_PROMPT } from './prompts';
import { type RetrievalResult } from '../embed/retriever';
import {
  estimateTokens as estimateTokensUtil,
  calculateTokenBudget,
  trimToTokenBudget,
} from '../utils/tokens';
import { traceLogger } from '../utils/trace-logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Estimate token count for a text string
 * Heuristic: ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  return estimateTokensUtil(text);
}

/**
 * Validate user input length based on token budget
 * Returns error message if input exceeds limit, null otherwise
 */
export function validateUserInput(text: string, maxInputTokens?: number): string | null {
  const tokens = estimateTokens(text);
  const budget = calculateTokenBudget(maxInputTokens ?? 2000);

  if (tokens > budget.userMessageReserve) {
    return `Message too long: ${tokens} tokens (max ${budget.userMessageReserve} tokens). Please shorten your message.`;
  }

  return null;
}

/**
 * Context assembly configuration
 */
export interface ContextConfig {
  maxInputTokens: number;
  summary?: Summary | null;
  retrievedSnippets?: RetrievalResult[];
}

/**
 * Assembles context for LLM generation with dynamic token budget.
 * Phase 5: Full memory system with summary + retrieval + buffer
 *
 * Context structure:
 * 1. System prompt
 * 2. Rolling summary (if exists)
 * 3. Retrieved snippets (from semantic search)
 * 4. Recent buffer messages
 * 5. New user message (added by caller)
 */
export function assembleContext(
  recentMessages: Message[],
  config: ContextConfig
): ChatMessage[] {
  // TODO(student): build the prompt context in layer order (system -> rolling summary -> retrieved snippets -> recent buffer) within the per-section token budget, de-duplicating by timestamp and trimming gracefully when space runs out. See the lecture materials.
  void recentMessages; void config;
  void SYSTEM_PROMPT; void trimToTokenBudget; void traceLogger; void getTimeAgo;
  throw new Error('TODO(student): implement assembleContext');
}

/**
 * Get human-readable time ago string
 */
function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
