/**
 * Rolling Summary System
 *
 * Generates and manages rolling summaries of conversation history
 * to extend effective memory beyond token limits.
 */

import { db, type Message, type Summary } from '../db/db';
import { SUMMARY_PROMPT } from './prompts';
import { estimateTokens, needsSummary, selectMessagesForSummary } from '../utils/tokens';
import { traceLogger } from '../utils/trace-logger';

/**
 * Check if conversation needs summarization
 */
export async function checkNeedsSummary(
  threadId: string,
  bufferTokenBudget: number
): Promise<boolean> {
  try {
    // Get all messages for thread
    const messages = await db.messages
      .where('threadId')
      .equals(threadId)
      .sortBy('timestamp');

    // Get latest summary if exists
    const latestSummary = await db.summaries
      .where('threadId')
      .equals(threadId)
      .reverse()
      .first();

    // Filter messages that aren't already summarized
    const unsummarizedMessages = latestSummary
      ? messages.filter(m => m.timestamp > latestSummary.upToTs)
      : messages;

    // Calculate total tokens in unsummarized messages
    const bufferTokens = unsummarizedMessages.reduce(
      (sum, msg) => sum + estimateTokens(msg.text),
      0
    );

    return needsSummary(bufferTokens, bufferTokenBudget);
  } catch (error) {
    traceLogger.error('Summary', 'Failed to check if summary needed', error);
    return false;
  }
}

/**
 * Generate summary for a set of messages
 * Uses LLM to create concise bullet-point summary
 */
export async function generateSummary(
  messages: Message[],
  generateFn: (prompt: string) => Promise<string>
): Promise<string> {
  if (messages.length === 0) {
    return '';
  }

  try {
    traceLogger.info('Summary', 'Generating summary', { messageCount: messages.length });

    // Format messages into readable conversation
    const conversation = messages
      .map(m => `${m.role}: ${m.text}`)
      .join('\n\n');

    // Construct prompt
    const prompt = `${SUMMARY_PROMPT}\n\nConversation:\n${conversation}`;

    // Call LLM to generate summary
    const summary = await generateFn(prompt);

    traceLogger.info('Summary', 'Summary generated', {
      inputTokens: estimateTokens(conversation),
      outputTokens: estimateTokens(summary),
    });

    return summary;
  } catch (error) {
    traceLogger.error('Summary', 'Failed to generate summary', error);
    throw error;
  }
}

/**
 * Update rolling summary incrementally
 * Combines old summary with new chunk summary
 */
export async function updateRollingSummary(
  threadId: string,
  bufferTokenBudget: number,
  generateFn: (prompt: string) => Promise<string>
): Promise<Summary | null> {
  try {
    traceLogger.info('Summary', 'Updating rolling summary', { threadId });

    // Get all messages
    const allMessages = await db.messages
      .where('threadId')
      .equals(threadId)
      .sortBy('timestamp');

    if (allMessages.length === 0) {
      return null;
    }

    // Get latest summary if exists
    const latestSummary = await db.summaries
      .where('threadId')
      .equals(threadId)
      .reverse()
      .first();

    // Filter messages that aren't summarized yet
    const unsummarizedMessages = latestSummary
      ? allMessages.filter(m => m.timestamp > latestSummary.upToTs)
      : allMessages;

    if (unsummarizedMessages.length === 0) {
      return latestSummary || null;
    }

    // Calculate how many tokens to reduce
    const currentTokens = unsummarizedMessages.reduce(
      (sum, msg) => sum + estimateTokens(msg.text),
      0
    );
    const targetReduction = currentTokens - bufferTokenBudget * 0.5; // Target 50% of budget

    // Select messages to summarize (oldest first)
    const toSummarize = selectMessagesForSummary(unsummarizedMessages, targetReduction);

    if (toSummarize.length === 0) {
      return latestSummary || null;
    }

    // Generate new chunk summary
    const chunkSummary = await generateSummary(toSummarize, generateFn);

    // Combine with existing summary if present
    let finalSummary: string;
    if (latestSummary) {
      finalSummary = `${latestSummary.text}\n\n${chunkSummary}`;
    } else {
      finalSummary = chunkSummary;
    }

    // Save new summary
    const lastMessage = toSummarize[toSummarize.length - 1];
    const newSummary: Summary = {
      threadId,
      upToTs: lastMessage.timestamp,
      text: finalSummary,
    };

    const summaryId = await db.summaries.add(newSummary);
    const savedSummary = await db.summaries.get(summaryId);

    traceLogger.info('Summary', 'Rolling summary updated', {
      summarizedCount: toSummarize.length,
      upToTs: newSummary.upToTs,
    });

    return savedSummary || null;
  } catch (error) {
    traceLogger.error('Summary', 'Failed to update rolling summary', error);
    throw error;
  }
}

/**
 * Get latest summary for a thread
 */
export async function getLatestSummary(threadId: string): Promise<Summary | null> {
  try {
    const summary = await db.summaries
      .where('threadId')
      .equals(threadId)
      .reverse()
      .first();

    return summary || null;
  } catch (error) {
    traceLogger.error('Summary', 'Failed to get latest summary', error);
    return null;
  }
}

/**
 * Rebuild summary from scratch
 * Useful for manual reset or corruption recovery
 */
export async function rebuildSummary(
  threadId: string,
  generateFn: (prompt: string) => Promise<string>
): Promise<void> {
  try {
    traceLogger.info('Summary', 'Rebuilding summary from scratch', { threadId });

    // Delete all existing summaries
    await db.summaries.where('threadId').equals(threadId).delete();

    // Get all messages
    const messages = await db.messages
      .where('threadId')
      .equals(threadId)
      .sortBy('timestamp');

    if (messages.length === 0) {
      return;
    }

    // Generate new summary for all messages
    const summaryText = await generateSummary(messages, generateFn);

    // Save summary
    const lastMessage = messages[messages.length - 1];
    await db.summaries.add({
      threadId,
      upToTs: lastMessage.timestamp,
      text: summaryText,
    });

    traceLogger.info('Summary', 'Summary rebuilt successfully');
  } catch (error) {
    traceLogger.error('Summary', 'Failed to rebuild summary', error);
    throw error;
  }
}
