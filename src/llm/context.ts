import { type Message, type Summary } from '../db/db';
import { SYSTEM_PROMPT } from './prompts';
import { type RetrievalResult } from '../embed/retriever';
import {
  estimateTokens as estimateTokensUtil,
  calculateTokenBudget,
  trimToTokenBudget as keepNewestUntilFits,
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
  const budget = calculateTokenBudget(config.maxInputTokens);
  const context: ChatMessage[] = [];

  /* ---- Layers 1-3: build ONE system message ----------------------- */
  let systemText = SYSTEM_PROMPT;
  let kept: RetrievalResult[] = []

  if (config.summary) {
    let summaryText = config.summary.text;

    if (estimateTokens(summaryText) > budget.summary) {
      const maxChars = budget.summary * 4;
      summaryText = "..." + summaryText.slice(-maxChars);
    }
    systemText += `\n\nSummary:\n${summaryText}`;
  }

  if (config.retrievedSnippets && config.retrievedSnippets.length > 0) {
    const sorted = [...config.retrievedSnippets].sort((a, b) => b.score - a.score);
    kept = dropWeakestUntilFits(sorted, budget.retrieval);
    if (kept.length > 0) {
      systemText += `\n\n${formatSnippets(kept)}`;
    }
  }

  context.push({ role: "system", content: systemText });

  /* ---- Layer 4: recent buffer as REAL dialogue turns --------------*/
  let buffer = dropTurnsAlreadyInSummary(recentMessages, config.summary);
  buffer = keepNewestUntilFits(buffer, budget.buffer);

  for (const msg of buffer) {
    context.push({ role: msg.role, content: msg.text });
  }
  /* ---- Layer 5: the new user message is appended by the caller ---- */
  traceLogger.info('Context', 'Context assembled', {
    budget,
    summaryIncluded: !!config.summary,
    summaryTruncated: config.summary
      ? estimateTokens(config.summary.text) > budget.summary
      : false,
    snippetsRetrieved: config.retrievedSnippets?.length ?? 0,
    snippetsKept: kept.length,
    bufferMessagesAvailable: recentMessages.length,
    bufferMessagesKept: buffer.length,
    totalContextMessages: context.length,
  });

  return context;
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

function formatSnippets(snippets: RetrievalResult[]): string {
  const lines = snippets.map((snippet, index) =>
    `[${index}] (${getTimeAgo(snippet.message.timestamp)}, relevance: ${snippet.score.toFixed(2)}): snippet: ${snippet.message.text}`
  );

  return `Relevant context from past conversation:\n${lines.join("\n")}`;
}

function dropWeakestUntilFits(snippets: RetrievalResult[], retrievalBudget: number): RetrievalResult[] {
  const kept: RetrievalResult[] = [];
  let used = 0;

  for (let i = 0; i < snippets.length; i++) {
    const t = estimateTokens(snippets[i].message.text);
    if (used + t > retrievalBudget) {
      break;
    }
    kept.push(snippets[i]);
    used += t;
  }

  return kept;
}

function dropTurnsAlreadyInSummary(recentMessages: Message[], summary?: Summary | null): Message[] {
  if (!summary) {
    return recentMessages;
  }
  return recentMessages.filter((message) => message.timestamp > summary.upToTs)
}