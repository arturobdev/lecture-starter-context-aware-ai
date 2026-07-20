/**
 * Embedding Worker
 *
 * Web Worker for computing text embeddings using Transformers.js.
 * Runs in separate thread to avoid blocking UI.
 *
 * Features:
 * - WebGPU acceleration (with WASM fallback)
 * - Feature extraction pipeline
 * - Batch processing support
 *
 * Note: Uses console for logging since Web Workers run in isolated context
 * and cannot import main thread modules like traceLogger.
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure Transformers.js for browser
env.allowLocalModels = false;
env.useBrowserCache = true;

// Message types
export interface EmbedRequest {
  id: string;
  text: string;
}

export interface EmbedResponse {
  id: string;
  embedding: Float32Array;
}

export interface DeviceInfo {
  device: string;
}

export interface ErrorInfo {
  message: string;
}

export interface ProgressInfo {
  step: string;
}

export interface WorkerMessage {
  type: 'init' | 'embed' | 'embed-batch';
  payload?: EmbedRequest | EmbedRequest[];
}

export interface WorkerResponse {
  type: 'ready' | 'embedded' | 'error' | 'progress';
  payload?: EmbedResponse | EmbedResponse[] | DeviceInfo | ErrorInfo | ProgressInfo;
}

// Default model: all-MiniLM-L6-v2 (384 dims, ~25MB)
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
let isReady = false;

/**
 * Initialize the embedding pipeline
 */
async function initPipeline(): Promise<void> {
  try {
    console.log('[EmbedWorker] Initializing pipeline...');
    postMessage({ type: 'progress', payload: { step: 'Downloading model...' } } satisfies WorkerResponse);

    // Try WebGPU first, fallback to WASM
    let device: 'webgpu' | 'wasm' = 'wasm';

    if ('gpu' in navigator) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (navigator as any).gpu?.requestAdapter();
        device = 'webgpu';
        console.log('[EmbedWorker] WebGPU available, using GPU acceleration');
      } catch (e) {
        console.warn('[EmbedWorker] WebGPU not available, falling back to WASM', e);
      }
    }

    extractor = await pipeline('feature-extraction', DEFAULT_MODEL, {
      device,
      dtype: device === 'webgpu' ? 'fp32' : 'fp32',
    });

    isReady = true;
    console.log('[EmbedWorker] Pipeline ready with device:', device);
    const deviceInfo: DeviceInfo = { device };
    postMessage({ type: 'ready', payload: deviceInfo } satisfies WorkerResponse);
  } catch (error) {
    console.error('[EmbedWorker] Failed to initialize:', error);
    const errorInfo: ErrorInfo = { message: `Initialization failed: ${error}` };
    postMessage({
      type: 'error',
      payload: errorInfo
    } satisfies WorkerResponse);
  }
}

/**
 * Embed a single text
 */
async function embedText(request: EmbedRequest): Promise<EmbedResponse> {
  if (!isReady || !extractor) {
    throw new Error('Pipeline not ready');
  }

  try {
    // Run the model
    const output = await extractor(request.text, {
      pooling: 'mean',
      normalize: true,
    });

    // Extract the embedding as Float32Array
    const embedding = new Float32Array(output.data);

    return {
      id: request.id,
      embedding,
    };
  } catch (error) {
    console.error('[EmbedWorker] Embedding failed for', request.id, error);
    throw error;
  }
}

/**
 * Embed multiple texts
 */
async function embedBatch(requests: EmbedRequest[]): Promise<EmbedResponse[]> {
  if (!isReady || !extractor) {
    throw new Error('Pipeline not ready');
  }

  const results: EmbedResponse[] = [];

  for (const req of requests) {
    try {
      const result = await embedText(req);
      results.push(result);
    } catch (error) {
      console.error('[EmbedWorker] Failed to embed', req.id, error);
      // Continue with other items
    }
  }

  return results;
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case 'init': {
        await initPipeline();
        break;
      }

      case 'embed': {
        if (!payload || Array.isArray(payload)) {
          throw new Error('Invalid payload for embed');
        }
        const result = await embedText(payload as EmbedRequest);
        postMessage({ type: 'embedded', payload: result } satisfies WorkerResponse);
        break;
      }

      case 'embed-batch': {
        if (!payload || !Array.isArray(payload)) {
          throw new Error('Invalid payload for embed-batch');
        }
        const results = await embedBatch(payload as EmbedRequest[]);
        postMessage({ type: 'embedded', payload: results } satisfies WorkerResponse);
        break;
      }

      default:
        console.warn('[EmbedWorker] Unknown message type:', type);
    }
  } catch (error) {
    console.error('[EmbedWorker] Error handling message:', error);
    const errorInfo: ErrorInfo = { message: String(error) };
    postMessage({
      type: 'error',
      payload: errorInfo
    } satisfies WorkerResponse);
  }
};

// Auto-initialize on startup
initPipeline();
