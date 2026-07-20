/**
 * Database Operations
 *
 * High-level operations for managing messages and related data
 */

import { db, type Message } from './db';
import { traceLogger } from '../utils/trace-logger';

/**
 * Delete a message and all related data
 * If it's a user message, also delete the following assistant message
 */
export async function deleteMessage(messageId: number): Promise<void> {
  try {
    // Get the message to determine if we need to delete a follow-up
    const message = await db.messages.get(messageId);
    if (!message) {
      traceLogger.warn('DbOperations', 'Message not found', { messageId });
      return;
    }

    traceLogger.info('DbOperations', 'Deleting message', { messageId, role: message.role });

    // If it's a user message, find and delete the following assistant message
    let assistantMessageId: number | undefined;
    if (message.role === 'user') {
      const assistantMessage = await db.messages
        .where('threadId')
        .equals(message.threadId)
        .and((msg) => msg.timestamp > message.timestamp && msg.role === 'assistant')
        .first();

      if (assistantMessage?.id) {
        assistantMessageId = assistantMessage.id;
      }
    }

    // Delete embeddings for this message
    await db.embeddings.where('msgId').equals(messageId).delete();

    // Delete facts extracted from this message
    await db.facts.where('sourceMsgId').equals(messageId).delete();

    // Delete the message itself
    await db.messages.delete(messageId);

    // If there's a follow-up assistant message, delete it too
    if (assistantMessageId) {
      await db.embeddings.where('msgId').equals(assistantMessageId).delete();
      await db.facts.where('sourceMsgId').equals(assistantMessageId).delete();
      await db.messages.delete(assistantMessageId);
      traceLogger.info('DbOperations', 'Deleted follow-up assistant message', {
        assistantMessageId
      });
    }

    traceLogger.info('DbOperations', 'Message deleted successfully', {
      messageId,
      deletedFollowUp: !!assistantMessageId
    });
  } catch (error) {
    traceLogger.error('DbOperations', 'Failed to delete message', { messageId, error });
    throw error;
  }
}

/**
 * Delete a user message and its assistant response as a pair
 */
export async function deleteMessagePair(userMessageId: number): Promise<void> {
  return deleteMessage(userMessageId);
}

/**
 * Get all messages for a thread ordered by timestamp
 */
export async function getThreadMessages(threadId: string): Promise<Message[]> {
  return db.messages
    .where('threadId')
    .equals(threadId)
    .sortBy('timestamp');
}
