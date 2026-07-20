/**
 * Semantic Retrieval
 *
 * Retrieves relevant messages using ANN search on embeddings.
 *
 * Features:
 * - Top-k similarity search
 * - Recency boost (future enhancement)
 * - MMR for diversity (future enhancement)
 */

import { db, type Message } from '../db/db';
import { ANNIndex, type SearchResult } from './ann';
import { embedService } from './embed-service';
import { traceLogger } from '../utils/trace-logger';

export interface RetrievalResult {
  message: Message;
  score: number; // Cosine similarity (0-1, higher is better)
  distance: number; // Raw distance from ANN
}

export interface RetrievalConfig {
  k?: number; // Number of results (default: 5)
  minScore?: number; // Minimum similarity score (default: 0.5)
  threadId?: string; // Filter by thread (default: 'default')
  useRecencyBoost?: boolean; // Apply recency boost to scores (default: true)
  recencyAlpha?: number; // Weight for semantic similarity (default: 0.7)
  recencyBeta?: number; // Weight for recency (default: 0.3)
  useMMR?: boolean; // Use Maximal Marginal Relevance for diversity (default: false)
  mmrLambda?: number; // MMR tradeoff: 1=relevance only, 0=diversity only (default: 0.7)
}

/**
 * Global ANN index instance
 */
let annIndex: ANNIndex | null = null;
const DEFAULT_DIM = 384; // Dimension for all-MiniLM-L6-v2

/**
 * Initialize the ANN index
 */
export async function initRetriever(threadId = 'default-thread'): Promise<void> {
  try {
    traceLogger.info('Retriever', 'Initializing retriever...', { threadId });

    // Create new index
    annIndex = new ANNIndex({
      dim: DEFAULT_DIM,
      maxElements: 1000,
      m: 16,
      efConstruction: 200,
      efSearch: 50,
    });

    // Try to load from IDBFS
    const loaded = await annIndex.load();

    if (!loaded) {
      traceLogger.info('Retriever', 'No saved index in IDBFS, checking database...');

      // Check if we have embeddings in the database
      const embeddingCount = await db.embeddings
        .where('threadId')
        .equals(threadId)
        .count();

      if (embeddingCount > 0) {
        // Rebuild index from database embeddings
        traceLogger.info('Retriever', `Found ${embeddingCount} embeddings in database, rebuilding index...`);
        await annIndex.init();

        const embeddings = await db.embeddings
          .where('threadId')
          .equals(threadId)
          .toArray();

        for (const emb of embeddings) {
          const vector = new Float32Array(await emb.vec.arrayBuffer());
          annIndex.addPoint(vector, emb.msgId);
        }

        // Save the rebuilt index to IDBFS
        await annIndex.saveNow();

        traceLogger.info('Retriever', 'Index rebuilt from database', {
          size: annIndex.getSize(),
        });
      } else {
        // No embeddings yet, initialize empty index
        traceLogger.info('Retriever', 'No embeddings in database, initializing empty index');
        await annIndex.init();
      }
    } else {
      traceLogger.info('Retriever', 'Index loaded from IDBFS');
    }

    traceLogger.info('Retriever', 'Retriever initialized', {
      size: annIndex.getSize(),
      capacity: annIndex.getCapacity(),
    });
  } catch (error) {
    traceLogger.error('Retriever', 'Failed to initialize retriever', error);
    throw error;
  }
}

/**
 * Rebuild index from embeddings table
 */
export async function rebuildIndex(threadId = 'default-thread'): Promise<void> {
  try {
    traceLogger.info('Retriever', 'Rebuilding index from embeddings...');

    if (!annIndex) {
      annIndex = new ANNIndex({
        dim: DEFAULT_DIM,
        maxElements: 1000,
      });
      await annIndex.init();
    } else {
      annIndex.clear();
      await annIndex.init();
    }

    // Load all embeddings
    const embeddings = await db.embeddings
      .where('threadId')
      .equals(threadId)
      .toArray();

    traceLogger.info('Retriever', 'Found embeddings to rebuild', {
      count: embeddings.length,
    });

    // Add to index
    for (const emb of embeddings) {
      const vector = new Float32Array(await emb.vec.arrayBuffer());
      annIndex.addPoint(vector, emb.msgId);
    }

    // Save to IDBFS immediately (rebuild should not be debounced)
    await annIndex.saveNow();

    traceLogger.info('Retriever', 'Index rebuilt successfully', {
      size: annIndex.getSize(),
    });
  } catch (error) {
    traceLogger.error('Retriever', 'Failed to rebuild index', error);
    throw error;
  }
}

/**
 * Add a message embedding to the index
 */
export async function addEmbedding(
  msgId: number,
  embedding: Float32Array,
  threadId = 'default-thread'
): Promise<void> {
  if (!annIndex) {
    await initRetriever(threadId);
  }

  try {
    // Add to ANN index
    annIndex!.addPoint(embedding, msgId);

    // Save embedding to database
    // Convert to ArrayBuffer explicitly to satisfy TypeScript
    const buffer = embedding.buffer as ArrayBuffer;
    const blob = new Blob([buffer]);
    await db.embeddings.add({
      threadId,
      msgId,
      dim: embedding.length,
      vec: blob,
    });

    // Save updated index to IDBFS
    await annIndex!.save();

    traceLogger.info('Retriever', 'Embedding added', {
      msgId,
      indexSize: annIndex!.getSize(),
    });
  } catch (error) {
    traceLogger.error('Retriever', 'Failed to add embedding', { msgId, error });
    throw error;
  }
}

/**
 * Remove a message embedding from the index
 * Note: hnswlib doesn't support point deletion, so we rebuild the index
 */
export async function removeEmbedding(msgId: number, threadId = 'default-thread'): Promise<void> {
  try {
    traceLogger.info('Retriever', 'Removing embedding', { msgId });

    // Delete from database
    await db.embeddings.where('msgId').equals(msgId).delete();

    // Rebuild index (hnswlib doesn't support deletion)
    if (annIndex && annIndex.getSize() > 0) {
      await rebuildIndex(threadId);
      traceLogger.info('Retriever', 'Index rebuilt after deletion');
    }
  } catch (error) {
    traceLogger.error('Retriever', 'Failed to remove embedding', { msgId, error });
    throw error;
  }
}

/**
 * Calculate recency boost for a message
 * Returns value between 0 and 1, higher for more recent messages
 */
function calculateRecencyBoost(timestamp: number): number {
  // TODO(student): return a recency weight in [0,1] derived from a timestamp (logarithmic decay). See the lecture materials.
  void timestamp;
  throw new Error('TODO(student): implement calculateRecencyBoost');
}

/**
 * Calculate combined score with recency boost
 */
function calculateCombinedScore(
  cosineSimilarity: number,
  recencyBoost: number,
  alpha: number,
  beta: number
): number {
  // TODO(student): return alpha*cosineSimilarity + beta*recencyBoost. See the lecture materials.
  void cosineSimilarity; void recencyBoost; void alpha; void beta;
  throw new Error('TODO(student): implement calculateCombinedScore');
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // TODO(student): return cosine similarity between two vectors (dot product of normalized vectors). See the lecture materials.
  void a; void b;
  throw new Error('TODO(student): implement cosineSimilarity');
}

/**
 * Maximal Marginal Relevance (MMR) for diversity
 * Selects k diverse items from candidates
 */
async function applyMMR(
  queryVector: Float32Array,
  candidates: RetrievalResult[],
  k: number,
  lambda: number
): Promise<RetrievalResult[]> {
  if (candidates.length <= k) {
    return candidates;
  }

  const selected: RetrievalResult[] = [];
  const remaining = [...candidates];

  // Get embeddings for all candidates
  const candidateEmbeddings = new Map<number, Float32Array>();
  for (const candidate of candidates) {
    if (!candidate.message.id) continue;

    const embedding = await db.embeddings
      .where('msgId')
      .equals(candidate.message.id)
      .first();

    if (embedding) {
      const vector = new Float32Array(await embedding.vec.arrayBuffer());
      candidateEmbeddings.set(candidate.message.id, vector);
    }
  }

  // Select first item (highest relevance)
  selected.push(remaining[0]);
  remaining.splice(0, 1);

  // Iteratively select remaining items
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      if (!candidate.message.id) continue;

      const candidateVec = candidateEmbeddings.get(candidate.message.id);
      if (!candidateVec) continue;

      // Relevance to query
      const relevance = cosineSimilarity(queryVector, candidateVec);

      // Maximum similarity to already selected items
      let maxSimilarity = 0;
      for (const selected_item of selected) {
        if (!selected_item.message.id) continue;

        const selectedVec = candidateEmbeddings.get(selected_item.message.id);
        if (!selectedVec) continue;

        const similarity = cosineSimilarity(candidateVec, selectedVec);
        maxSimilarity = Math.max(maxSimilarity, similarity);
      }

      // MMR score: balance relevance and diversity
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    // Add best item to selected
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

/**
 * Retrieve relevant messages for a query
 */
export async function retrieveRelevant(
  query: string,
  config: RetrievalConfig = {}
): Promise<RetrievalResult[]> {
  const {
    k = 5,
    minScore = 0.5,
    useRecencyBoost = true,
    recencyAlpha = 0.7,
    recencyBeta = 0.3,
    useMMR = false,
    mmrLambda = 0.7,
  } = config;

  if (!annIndex || annIndex.getSize() === 0) {
    traceLogger.warn('Retriever', 'No embeddings available for retrieval');
    return [];
  }

  try {
    traceLogger.debug('Retriever', 'Starting retrieval', {
      query,
      k,
      useRecencyBoost,
      useMMR
    });

    // Embed the query
    const embedResult = await embedService.embedText(query);
    const queryVector = embedResult.embedding;

    // Search ANN index (fetch more candidates if using MMR)
    const searchK = useMMR ? k * 3 : k;
    const searchResults: SearchResult[] = annIndex.searchKnn(queryVector, searchK);

    // Convert distances to similarity scores and apply recency boost
    const results: RetrievalResult[] = [];

    for (const result of searchResults) {
      // Convert cosine distance to similarity
      const cosineSim = 1 - result.distance;

      // Fetch message from database
      const message = await db.messages.get(result.id);
      if (!message) {
        traceLogger.warn('Retriever', 'Message not found for embedding', {
          msgId: result.id,
        });
        continue;
      }

      // Calculate final score
      let finalScore = cosineSim;
      if (useRecencyBoost) {
        const recency = calculateRecencyBoost(message.timestamp);
        finalScore = calculateCombinedScore(cosineSim, recency, recencyAlpha, recencyBeta);
      }

      // Filter by minimum score
      if (finalScore < minScore) {
        continue;
      }

      results.push({
        message,
        score: finalScore,
        distance: result.distance,
      });
    }

    // Sort by final score (descending)
    results.sort((a, b) => b.score - a.score);

    // Apply MMR if enabled
    let finalResults = results;
    if (useMMR && results.length > k) {
      finalResults = await applyMMR(queryVector, results, k, mmrLambda);
    } else {
      // Otherwise just take top k
      finalResults = results.slice(0, k);
    }

    traceLogger.info('Retriever', 'Retrieval completed', {
      query,
      found: finalResults.length,
      scores: finalResults.map(r => r.score.toFixed(3)),
      useRecencyBoost,
      useMMR,
    });

    return finalResults;
  } catch (error) {
    traceLogger.error('Retriever', 'Retrieval failed', { query, error });
    throw error;
  }
}

/**
 * Get retriever stats
 */
export function getRetrieverStats() {
  return {
    initialized: annIndex !== null,
    size: annIndex?.getSize() || 0,
    capacity: annIndex?.getCapacity() || 0,
  };
}
