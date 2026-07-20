/**
 * Model preloading utilities
 */

import { traceLogger } from '../utils/trace-logger';

export interface PreloadProgress {
  loaded: number;
  total: number;
  percent: number;
  fileName?: string;
}

export type PreloadCallback = (progress: PreloadProgress) => void;

/**
 * Preload model files to cache
 */
export async function preloadModel(
  modelUrls: string[],
  onProgress?: PreloadCallback
): Promise<void> {
  const total = modelUrls.length;
  let loaded = 0;

  for (const url of modelUrls) {
    try {
      // Fetch to trigger SW cache
      const response = await fetch(url);
      if (!response.ok) {
        traceLogger.warn('Caching', `Failed to preload: ${url}`);
      }

      loaded++;
      const fileName = url.split('/').pop() || url;

      onProgress?.({
        loaded,
        total,
        percent: (loaded / total) * 100,
        fileName,
      });
    } catch (error) {
      traceLogger.error('Caching', `Error preloading ${url}`, error);
      loaded++;
      onProgress?.({
        loaded,
        total,
        percent: (loaded / total) * 100,
      });
    }
  }
}

/**
 * Get list of model URLs for preloading
 * This should match the model files used by WebLLM
 */
export function getModelUrls(modelId: string): string[] {
  // For MLC models, the URLs are generated dynamically by WebLLM
  // This is a simplified version - in production, you'd get these from WebLLM's model config
  const baseUrl = `https://huggingface.co/${modelId}/resolve/main`;

  // Common files for MLC models
  return [
    `${baseUrl}/mlc-chat-config.json`,
    `${baseUrl}/tokenizer.json`,
    `${baseUrl}/tokenizer_config.json`,
    // Model weights (actual files depend on the specific model)
    // These would be discovered from mlc-chat-config.json
  ];
}

/**
 * Check if model is cached
 */
export async function isModelCached(modelId: string): Promise<boolean> {
  if (!('caches' in window)) {
    return false;
  }

  try {
    const cache = await caches.open('models-v1');
    const urls = getModelUrls(modelId);

    for (const url of urls) {
      const response = await cache.match(url);
      if (!response) {
        return false;
      }
    }

    return true;
  } catch (error) {
    traceLogger.error('Caching', 'Error checking cache', error);
    return false;
  }
}
