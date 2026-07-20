/**
 * ANN Index Wrapper
 *
 * Wrapper around hnswlib-wasm for fast similarity search.
 * Uses HNSW (Hierarchical Navigable Small World) algorithm.
 *
 * Features:
 * - Cosine similarity search
 * - File-based persistence via IDBFS
 * - Dynamic capacity growth
 */

import { loadHnswlib, type HnswlibModule } from 'hnswlib-wasm';
import { traceLogger } from '../utils/trace-logger';

export interface SearchResult {
  id: number;
  distance: number;
}

export interface HNSWConfig {
  dim: number; // Embedding dimension
  maxElements?: number; // Initial capacity
  m?: number; // Number of bi-directional links (default: 16)
  efConstruction?: number; // Construction time parameter (default: 200)
  efSearch?: number; // Search time parameter (default: 50)
}

const INDEX_FILENAME = '/hnsw_index.bin';

// Module singleton
let hnswModule: HnswlibModule | null = null;

/**
 * Load HNSW module
 */
async function getModule(): Promise<HnswlibModule> {
  if (!hnswModule) {
    traceLogger.debug('ANN', 'Loading hnswlib module...');
    hnswModule = await loadHnswlib('IDBFS');
    traceLogger.info('ANN', 'hnswlib module loaded');
  }
  return hnswModule;
}

export class ANNIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private index: any | null = null;
  private dim: number;
  private currentSize = 0;
  private capacity: number;
  private m: number;
  private efConstruction: number;
  private efSearch: number;
  private saveTimeoutId: number | null = null;
  private isSaving = false;

  constructor(config: HNSWConfig) {
    this.dim = config.dim;
    this.capacity = config.maxElements || 1000;
    this.m = config.m || 16;
    this.efConstruction = config.efConstruction || 200;
    this.efSearch = config.efSearch || 50;

    traceLogger.info('ANN', 'Creating new index', {
      dim: this.dim,
      capacity: this.capacity,
    });
  }

  /**
   * Initialize the HNSW index
   */
  async init(): Promise<void> {
    try {
      traceLogger.debug('ANN', 'Initializing HNSW index...');

      const module = await getModule();

      this.index = new module.HierarchicalNSW('cosine', this.dim, '');
      this.index.initIndex(this.capacity, this.m, this.efConstruction, 100);
      this.index.setEfSearch(this.efSearch);

      traceLogger.info('ANN', 'Index initialized', {
        dim: this.dim,
        capacity: this.capacity,
      });
    } catch (error) {
      traceLogger.error('ANN', 'Failed to initialize index', error);
      throw error;
    }
  }

  /**
   * Add a vector to the index
   */
  addPoint(vector: Float32Array, id: number): void {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (vector.length !== this.dim) {
      throw new Error(`Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`);
    }

    try {
      // Check if we need to grow capacity
      if (this.currentSize >= this.capacity) {
        const newCapacity = this.capacity * 2;
        traceLogger.info('ANN', 'Growing index capacity', {
          from: this.capacity,
          to: newCapacity,
        });
        this.index.resizeIndex(newCapacity);
        this.capacity = newCapacity;
      }

      this.index.addPoint(vector, id, false);
      this.currentSize++;

      traceLogger.debug('ANN', 'Added point', { id, size: this.currentSize });
    } catch (error) {
      traceLogger.error('ANN', 'Failed to add point', { id, error });
      throw error;
    }
  }

  /**
   * Search for k nearest neighbors
   */
  searchKnn(queryVector: Float32Array, k: number): SearchResult[] {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    if (queryVector.length !== this.dim) {
      throw new Error(`Query vector dimension mismatch: expected ${this.dim}, got ${queryVector.length}`);
    }

    if (this.currentSize === 0) {
      traceLogger.warn('ANN', 'Search on empty index');
      return [];
    }

    try {
      const actualK = Math.min(k, this.currentSize);
      const result = this.index.searchKnn(queryVector, actualK, undefined);

      const results: SearchResult[] = [];
      for (let i = 0; i < result.neighbors.length; i++) {
        results.push({
          id: result.neighbors[i],
          distance: result.distances[i],
        });
      }

      traceLogger.debug('ANN', 'Search completed', {
        k: actualK,
        found: results.length,
      });

      return results;
    } catch (error) {
      traceLogger.error('ANN', 'Search failed', error);
      throw error;
    }
  }

  /**
   * Save index to IDBFS (debounced to prevent concurrent syncfs operations)
   */
  async save(): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Clear any pending save timeout
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }

    // Debounce: wait 500ms before saving to batch multiple additions
    return new Promise((resolve, reject) => {
      this.saveTimeoutId = window.setTimeout(async () => {
        // Skip if already saving
        if (this.isSaving) {
          traceLogger.debug('ANN', 'Save already in progress, skipping');
          resolve();
          return;
        }

        try {
          this.isSaving = true;
          const module = await getModule();
          await this.index.writeIndex(INDEX_FILENAME);
          await module.EmscriptenFileSystemManager.syncFS(false, () => {});

          traceLogger.info('ANN', 'Index saved', {
            size: this.currentSize,
            filename: INDEX_FILENAME,
          });

          this.isSaving = false;
          resolve();
        } catch (error) {
          traceLogger.error('ANN', 'Save failed', error);
          this.isSaving = false;
          reject(error);
        }
      }, 500);
    });
  }

  /**
   * Save immediately without debouncing (for explicit saves like rebuild)
   */
  async saveNow(): Promise<void> {
    if (!this.index) {
      throw new Error('Index not initialized');
    }

    // Clear any pending debounced save
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }

    // Wait if save is in progress
    while (this.isSaving) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    try {
      this.isSaving = true;
      const module = await getModule();
      await this.index.writeIndex(INDEX_FILENAME);
      await module.EmscriptenFileSystemManager.syncFS(false, () => {});

      traceLogger.info('ANN', 'Index saved', {
        size: this.currentSize,
        filename: INDEX_FILENAME,
      });

      this.isSaving = false;
    } catch (error) {
      traceLogger.error('ANN', 'Save failed', error);
      this.isSaving = false;
      throw error;
    }
  }

  /**
   * Load index from IDBFS
   */
  async load(): Promise<boolean> {
    try {
      traceLogger.debug('ANN', 'Loading index from IDBFS...');

      const module = await getModule();

      // Check if file exists
      const exists = module.EmscriptenFileSystemManager.checkFileExists(INDEX_FILENAME);
      if (!exists) {
        traceLogger.info('ANN', 'No saved index found');
        return false;
      }

      this.index = new module.HierarchicalNSW('cosine', this.dim, '');
      const loaded = await this.index.readIndex(INDEX_FILENAME, this.capacity);

      if (loaded) {
        this.currentSize = this.index.getCurrentCount();
        this.capacity = this.index.getMaxElements();
        this.index.setEfSearch(this.efSearch);

        traceLogger.info('ANN', 'Index loaded', {
          size: this.currentSize,
          capacity: this.capacity,
        });
        return true;
      }

      return false;
    } catch (error) {
      traceLogger.error('ANN', 'Load failed', error);
      return false;
    }
  }

  /**
   * Get current index size
   */
  getSize(): number {
    return this.currentSize;
  }

  /**
   * Get index capacity
   */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Check if index is initialized
   */
  isInitialized(): boolean {
    return this.index !== null;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.index = null;
    this.currentSize = 0;
    traceLogger.info('ANN', 'Index cleared');
  }
}
