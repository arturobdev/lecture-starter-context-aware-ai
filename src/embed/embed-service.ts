/**
 * Embedding Service
 *
 * Main thread wrapper for the embedding worker.
 * Manages worker lifecycle and provides async API for embeddings.
 */

import type { EmbedRequest, EmbedResponse, WorkerMessage, WorkerResponse } from './worker-embed';
import { traceLogger } from '../utils/trace-logger';

export type EmbedServiceStatus = 'initializing' | 'ready' | 'error';

export interface EmbedServiceState {
  status: EmbedServiceStatus;
  device?: 'webgpu' | 'wasm';
  error?: string;
}

class EmbedService {
  private worker: Worker | null = null;
  private state: EmbedServiceState = { status: 'initializing' };
  private pendingRequests = new Map<string, {
    resolve: (result: EmbedResponse) => void;
    reject: (error: Error) => void;
  }>();
  private onStateChangeCallback?: (state: EmbedServiceState) => void;

  constructor() {
    this.initWorker();
  }

  /**
   * Initialize the embedding worker
   */
  private initWorker(): void {
    try {
      traceLogger.info('EmbedService', 'Creating embedding worker...');

      this.worker = new Worker(
        new URL('./worker-embed.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      this.worker.onerror = this.handleWorkerError.bind(this);

      // Worker auto-initializes
    } catch (error) {
      traceLogger.error('EmbedService', 'Failed to create worker', error);
      this.updateState({ status: 'error', error: String(error) });
    }
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(e: MessageEvent<WorkerResponse>): void {
    const { type, payload } = e.data;

    switch (type) {
      case 'ready': {
        traceLogger.info('EmbedService', 'Worker ready', payload);
        const deviceInfo = payload as { device?: string };
        this.updateState({
          status: 'ready',
          device: (deviceInfo?.device as 'webgpu' | 'wasm') || 'wasm'
        });
        break;
      }

      case 'embedded': {
        if (Array.isArray(payload)) {
          // Batch response
          payload.forEach((result: EmbedResponse) => {
            this.resolveRequest(result.id, result);
          });
        } else {
          // Single response
          const result = payload as EmbedResponse;
          this.resolveRequest(result.id, result);
        }
        break;
      }

      case 'progress': {
        traceLogger.debug('EmbedService', 'Progress update', payload);
        break;
      }

      case 'error': {
        const errorInfo = payload as { message?: string };
        const errorMsg = errorInfo?.message || 'Unknown error';
        traceLogger.error('EmbedService', 'Worker error', errorMsg);

        // Reject all pending requests
        this.pendingRequests.forEach(({ reject }) => {
          reject(new Error(errorMsg));
        });
        this.pendingRequests.clear();

        this.updateState({ status: 'error', error: errorMsg });
        break;
      }
    }
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    traceLogger.error('EmbedService', 'Worker error event', error);
    this.updateState({ status: 'error', error: error.message });
  }

  /**
   * Resolve a pending request
   */
  private resolveRequest(id: string, result: EmbedResponse): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      pending.resolve(result);
      this.pendingRequests.delete(id);
      traceLogger.debug('EmbedService', 'Request resolved', { id });
    }
  }

  /**
   * Update service state
   */
  private updateState(newState: Partial<EmbedServiceState>): void {
    this.state = { ...this.state, ...newState };
    this.onStateChangeCallback?.(this.state);
  }

  /**
   * Embed a single text
   */
  async embedText(text: string, id?: string): Promise<EmbedResponse> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    if (this.state.status !== 'ready') {
      throw new Error(`Service not ready: ${this.state.status}`);
    }

    const requestId = id || `embed-${Date.now()}-${Math.random()}`;

    traceLogger.debug('EmbedService', 'Embedding text', {
      id: requestId,
      textLength: text.length
    });

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      const message: WorkerMessage = {
        type: 'embed',
        payload: { id: requestId, text } satisfies EmbedRequest,
      };

      this.worker!.postMessage(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Embedding timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Embed multiple texts
   */
  async embedBatch(texts: { text: string; id: string }[]): Promise<EmbedResponse[]> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    if (this.state.status !== 'ready') {
      throw new Error(`Service not ready: ${this.state.status}`);
    }

    traceLogger.debug('EmbedService', 'Embedding batch', { count: texts.length });

    const results = await Promise.all(
      texts.map(({ text, id }) => this.embedText(text, id))
    );

    return results;
  }

  /**
   * Get current service state
   */
  getState(): EmbedServiceState {
    return this.state;
  }

  /**
   * Register state change callback
   */
  onStateChange(callback: (state: EmbedServiceState) => void): void {
    this.onStateChangeCallback = callback;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      traceLogger.info('EmbedService', 'Worker terminated');
    }
  }
}

// Singleton instance
export const embedService = new EmbedService();
