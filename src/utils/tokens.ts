/**
 * Token Budget Utilities
 *
 * Dynamic token budget calculation based on hardware capabilities.
 * Uses percentages of available context window rather than fixed values.
 */

/**
 * Estimate token count for a text string
 * Heuristic: ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  // TODO(student): estimate a token count for a string (~4 chars/token heuristic). See the lecture materials.
  void text;
  throw new Error('TODO(student): implement estimateTokens');
}

/**
 * Calculate token budget allocation based on available input tokens
 *
 * Proportions (as percentages of maxInputTokens):
 * - System prompt: ~5%
 * - Rolling summary: ~15%
 * - Retrieved snippets: ~20%
 * - Recent buffer: ~50%
 * - Reserved for new user message: ~10%
 */
export interface TokenBudget {
  systemPrompt: number;
  summary: number;
  retrieval: number;
  buffer: number;
  userMessageReserve: number;
  total: number;
}

export function calculateTokenBudget(maxInputTokens: number): TokenBudget {
  // TODO(student): split the max input window into per-section allowances (system/summary/retrieval/buffer/userReserve). See the lecture materials.
  void maxInputTokens;
  throw new Error('TODO(student): implement calculateTokenBudget');
}

/**
 * Check if buffer needs summarization
 */
export function needsSummary(
  bufferTokens: number,
  budgetAllowance: number
): boolean {
  // TODO(student): decide whether the conversation should be summarized. See the lecture materials.
  void bufferTokens; void budgetAllowance;
  throw new Error('TODO(student): implement needsSummary');
}

/**
 * Calculate retrieval budget for k snippets
 */
export function calculateRetrievalBudget(
  retrievalBudget: number,
  k: number
): number {
  // Divide retrieval budget equally among k snippets
  return Math.floor(retrievalBudget / Math.max(k, 1));
}

/**
 * Get token statistics for debugging/display
 */
export interface TokenStats {
  used: number;
  available: number;
  percentage: number;
}

export function getTokenStats(
  usedTokens: number,
  totalBudget: number
): TokenStats {
  return {
    used: usedTokens,
    available: totalBudget - usedTokens,
    percentage: Math.round((usedTokens / totalBudget) * 100),
  };
}

/**
 * Validate if text fits within token limit
 */
export function validateTokenLimit(
  text: string,
  limit: number
): string | null {
  const tokens = estimateTokens(text);
  if (tokens > limit) {
    return `Text too long: ${tokens} tokens (max ${limit} tokens)`;
  }
  return null;
}

/**
 * Trim messages to fit within token budget
 * Returns messages from most recent backwards that fit within limit
 */
export function trimToTokenBudget<T extends { text: string }>(
  messages: T[],
  tokenBudget: number
): T[] {
  // TODO(student): trim text/messages so they fit within a token budget. See the lecture materials.
  void messages; void tokenBudget;
  throw new Error('TODO(student): implement trimToTokenBudget');
}

/**
 * Get human-readable token budget summary
 */
export function formatTokenBudget(budget: TokenBudget): string {
  return `
Token Budget Allocation (${budget.total} total):
  System Prompt: ${budget.systemPrompt} tokens (5%)
  Rolling Summary: ${budget.summary} tokens (15%)
  Retrieved Snippets: ${budget.retrieval} tokens (20%)
  Recent Buffer: ${budget.buffer} tokens (50%)
  User Message Reserve: ${budget.userMessageReserve} tokens (10%)
  `.trim();
}

/**
 * Calculate how many messages to summarize
 * Returns oldest messages that should be summarized
 */
export function selectMessagesForSummary<T extends { text: string }>(
  messages: T[],
  targetTokenReduction: number
): T[] {
  // TODO(student): choose the oldest messages to fold into the summary. See the lecture materials.
  void messages; void targetTokenReduction;
  throw new Error('TODO(student): implement selectMessagesForSummary');
}
