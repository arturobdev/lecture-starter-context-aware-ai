export const CHARS_PER_TOKEN = 4;
export const SUMMARY_TRIGGER_RATIO = 0.9;

export const BUDGET_RATIOS = {
  systemPrompt: 0.05,
  summary: 0.15,
  retrieval: 0.20,
  facts: 0.05,
  userMessageReserve: 0.10
} as const;

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = MS_PER_MINUTE * 60;
export const MS_PER_DAY = MS_PER_HOUR * 24;

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
  return Math.ceil(text.length / CHARS_PER_TOKEN);
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
  facts: number,
  total: number;
}

export function calculateTokenBudget(maxInputTokens: number): TokenBudget {
  const total = maxInputTokens;

  const systemPrompt = Math.floor(total * BUDGET_RATIOS.systemPrompt);
  const summary = Math.floor(total * BUDGET_RATIOS.summary);
  const retrieval = Math.floor(total * BUDGET_RATIOS.retrieval);
  const facts = Math.floor(total * BUDGET_RATIOS.facts);
  const userMessageReserve = Math.floor(total * BUDGET_RATIOS.userMessageReserve);

  const buffer = total - systemPrompt - summary - retrieval - userMessageReserve - facts;

  return {
    systemPrompt,
    summary,
    retrieval,
    buffer,
    facts,
    userMessageReserve,
    total
  };
}

/**
 * Check if buffer needs summarization
 */
export function needsSummary(
  bufferTokens: number,
  budgetAllowance: number
): boolean {
  const threshold = Math.floor(budgetAllowance * SUMMARY_TRIGGER_RATIO);
  return bufferTokens > threshold;
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
  const result: T[] = [];
  let currentTokens: number = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens: number = estimateTokens(messages[i].text);

    if (currentTokens + msgTokens > tokenBudget) {
      break;
    }

    result.unshift(messages[i]);
    currentTokens += msgTokens;
  }

  return result;
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
  const toSummarize: T[] = [];
  let tokenCount: number = 0;

  for (let i = 0; i < messages.length; i++) {
    toSummarize.push(messages[i]);
    tokenCount += estimateTokens(messages[i].text);

    if (tokenCount >= targetTokenReduction) {
      break;
    }
  }

  return toSummarize;
}
