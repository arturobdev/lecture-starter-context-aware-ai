/**
 * Fact Extraction System
 *
 * Extracts durable facts (names, preferences, goals, constraints)
 * from conversation messages for long-term memory.
 */

import { db, type Fact, type Message } from '../db/db';
import { FACTS_PROMPT } from './prompts';
import { traceLogger } from '../utils/trace-logger';

/**
 * Extract facts from a message using LLM
 */
export async function extractFacts(
  message: Message,
  generateFn: (prompt: string) => Promise<string>
): Promise<Fact[]> {
  if (!message.id) {
    traceLogger.warn('Facts', 'Cannot extract facts from message without ID');
    return [];
  }

  try {
    traceLogger.debug('Facts', 'Extracting facts from message', { msgId: message.id });

    // Construct prompt
    const prompt = `${FACTS_PROMPT}\n\nMessage:\n${message.role}: ${message.text}`;

    // Call LLM to extract facts
    const response = await generateFn(prompt);

    // Parse response into key-value pairs
    const facts = parseFacts(response, message.id, message.threadId);

    traceLogger.info('Facts', 'Facts extracted', {
      msgId: message.id,
      factCount: facts.length,
    });

    return facts;
  } catch (error) {
    traceLogger.error('Facts', 'Failed to extract facts', { msgId: message.id, error });
    return [];
  }
}

/**
 * Parse LLM response into Fact objects
 * Expected format: "key: value" bullet points
 */
function parseFacts(response: string, sourceMsgId: number, threadId: string): Fact[] {
  const facts: Fact[] = [];

  // Split by lines and process each line
  const lines = response.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and headers
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Remove bullet points and dashes
    const cleaned = trimmed.replace(/^[-*•]\s*/, '');

    // Look for key:value pattern
    const match = cleaned.match(/^(.+?):\s*(.+)$/);

    if (match) {
      const [, key, value] = match;
      facts.push({
        threadId,
        key: key.trim(),
        value: value.trim(),
        sourceMsgId,
      });
    }
  }

  return facts;
}

/**
 * Save extracted facts to database
 */
export async function saveFacts(facts: Fact[]): Promise<void> {
  if (facts.length === 0) {
    return;
  }

  try {
    // Batch insert all facts
    await db.facts.bulkAdd(facts);
    traceLogger.info('Facts', 'Facts saved to database', { count: facts.length });
  } catch (error) {
    traceLogger.error('Facts', 'Failed to save facts', error);
    throw error;
  }
}

/**
 * Extract and save facts from a message in one step
 */
export async function extractAndSaveFacts(
  message: Message,
  generateFn: (prompt: string) => Promise<string>
): Promise<number> {
  const facts = await extractFacts(message, generateFn);
  await saveFacts(facts);
  return facts.length;
}

/**
 * Get all facts for a thread
 */
export async function getThreadFacts(threadId: string): Promise<Fact[]> {
  try {
    const facts = await db.facts
      .where('threadId')
      .equals(threadId)
      .toArray();

    return facts;
  } catch (error) {
    traceLogger.error('Facts', 'Failed to get thread facts', error);
    return [];
  }
}

/**
 * Search facts by key
 */
export async function searchFactsByKey(
  threadId: string,
  keyPattern: string
): Promise<Fact[]> {
  try {
    const allFacts = await getThreadFacts(threadId);

    // Filter by key pattern (case-insensitive)
    const pattern = keyPattern.toLowerCase();
    const matches = allFacts.filter(f =>
      f.key.toLowerCase().includes(pattern)
    );

    return matches;
  } catch (error) {
    traceLogger.error('Facts', 'Failed to search facts', error);
    return [];
  }
}

/**
 * Get recent facts (last N)
 */
export async function getRecentFacts(
  threadId: string,
  limit = 10
): Promise<Fact[]> {
  try {
    const facts = await db.facts
      .where('threadId')
      .equals(threadId)
      .reverse()
      .limit(limit)
      .toArray();

    return facts;
  } catch (error) {
    traceLogger.error('Facts', 'Failed to get recent facts', error);
    return [];
  }
}

/**
 * Delete facts for a thread (cleanup)
 */
export async function deleteThreadFacts(threadId: string): Promise<void> {
  try {
    await db.facts.where('threadId').equals(threadId).delete();
    traceLogger.info('Facts', 'Thread facts deleted', { threadId });
  } catch (error) {
    traceLogger.error('Facts', 'Failed to delete thread facts', error);
    throw error;
  }
}

/**
 * Format facts for display
 */
export function formatFacts(facts: Fact[]): string {
  if (facts.length === 0) {
    return 'No facts extracted yet.';
  }

  return facts
    .map(f => `• ${f.key}: ${f.value}`)
    .join('\n');
}
