import Dexie, { type EntityTable } from 'dexie';

// Message interface
export interface Message {
  id?: number;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
}

// Rolling summary interface
export interface Summary {
  id?: number;
  threadId: string;
  upToTs: number; // Timestamp up to which this summary covers
  text: string;
}

// Extracted facts interface
export interface Fact {
  id?: number;
  threadId: string;
  key: string;
  value: string;
  sourceMsgId: number;
}

// Embedding vector interface
export interface Embedding {
  id?: number;
  threadId: string;
  msgId: number;
  dim: number; // Dimension of the embedding
  vec: Blob; // Float32Array stored as Blob
}

// HNSW index storage interface
export interface HNSWIndex {
  threadId: string; // Primary key
  blob: ArrayBuffer; // Serialized HNSW index
}

// Define the database
const db = new Dexie('offchat-bsa') as Dexie & {
  messages: EntityTable<Message, 'id'>;
  summaries: EntityTable<Summary, 'id'>;
  facts: EntityTable<Fact, 'id'>;
  embeddings: EntityTable<Embedding, 'id'>;
  hnsw: EntityTable<HNSWIndex, 'threadId'>;
};

// Schema declaration
db.version(1).stores({
  messages: '++id, threadId, timestamp, role',
  summaries: '++id, threadId, upToTs',
  facts: '++id, threadId, key, sourceMsgId',
  embeddings: '++id, threadId, msgId',
  hnsw: 'threadId',
});

export { db };
