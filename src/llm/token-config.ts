/**
 * Dynamic token limit configuration based on GPU capabilities and model specifications
 */

import { traceLogger } from '../utils/trace-logger';

export interface ModelSpec {
  name: string;
  params: number; // in billions
  contextWindow: number;
  kvCacheBytesPerToken: number; // approximate
}

export interface GPUCapabilities {
  vendor: string;
  maxStorageBuffer: number; // bytes
  estimatedVRAM: number; // MB
}

export interface TokenLimits {
  maxInput: number;
  maxOutput: number;
  recommendedInput: number;
  recommendedOutput: number;
  warningThreshold: number;
}

// Known model specifications
export const MODEL_SPECS: Record<string, ModelSpec> = {
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': {
    name: 'Llama-3.2-1B',
    params: 1,
    contextWindow: 131072, // 128K
    kvCacheBytesPerToken: 72000, // ~72KB per token
  },
  'gemma-2-2b-it-q4f16_1-MLC': {
    name: 'Gemma-2-2B',
    params: 2,
    contextWindow: 8192, // 8K
    kvCacheBytesPerToken: 144000, // ~144KB per token (2x Llama)
  },
  'Phi-3-mini-4k-instruct-q4f16_1-MLC': {
    name: 'Phi-3-mini',
    params: 3.8,
    contextWindow: 4096,
    kvCacheBytesPerToken: 200000, // ~200KB per token
  },
};

/**
 * Detect GPU capabilities from WebGPU adapter
 */
export async function detectGPUCapabilities(): Promise<GPUCapabilities | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu;
  if (!gpu) return null;

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;

    // Get max storage buffer size (indicates VRAM capacity)
    const maxStorageBuffer = adapter.limits.maxStorageBufferBindingSize || 0;

    // Estimate available VRAM based on buffer size
    // Heuristic: maxStorageBuffer is typically 1/4 to 1/2 of available VRAM
    const estimatedVRAM = Math.floor((maxStorageBuffer / (1024 * 1024)) * 2); // Convert to MB and estimate

    // Get vendor info
    const info = await adapter.requestAdapterInfo?.();
    const vendor = info?.vendor || 'unknown';

    return {
      vendor,
      maxStorageBuffer,
      estimatedVRAM,
    };
  } catch (error) {
    traceLogger.error('TokenConfig', 'Failed to detect GPU capabilities', error);
    return null;
  }
}

/**
 * Calculate optimal token limits based on GPU and model
 */
export function calculateTokenLimits(
  modelId: string,
  gpuCapabilities: GPUCapabilities | null
): TokenLimits {
  const modelSpec = MODEL_SPECS[modelId];

  // Fallback to conservative limits if model unknown
  if (!modelSpec) {
    return {
      maxInput: 2000,
      maxOutput: 500,
      recommendedInput: 1000,
      recommendedOutput: 300,
      warningThreshold: 1500,
    };
  }

  // Fallback to conservative limits if GPU detection failed
  if (!gpuCapabilities) {
    return {
      maxInput: Math.min(2000, modelSpec.contextWindow),
      maxOutput: 500,
      recommendedInput: 1000,
      recommendedOutput: 300,
      warningThreshold: 1500,
    };
  }

  // Calculate available VRAM for KV cache (subtract model size estimate)
  const modelSizeMB = modelSpec.params * 600; // Rough estimate: 600MB per billion params (q4f16)
  const availableForKV = Math.max(0, gpuCapabilities.estimatedVRAM - modelSizeMB);

  // Calculate max tokens based on KV cache VRAM
  const maxTokensByVRAM = Math.floor(
    (availableForKV * 1024 * 1024) / modelSpec.kvCacheBytesPerToken
  );

  // Apply safety margin (use 70% of theoretical max)
  const safeMaxTokens = Math.floor(maxTokensByVRAM * 0.7);

  // Constrain by model's context window
  const maxTotalTokens = Math.min(safeMaxTokens, modelSpec.contextWindow);

  // Split between input and output (70% input, 30% output)
  const maxInput = Math.floor(maxTotalTokens * 0.7);
  const maxOutput = Math.floor(maxTotalTokens * 0.3);

  // Recommended limits (50% of max for smooth experience)
  const recommendedInput = Math.floor(maxInput * 0.5);
  const recommendedOutput = Math.floor(maxOutput * 0.5);

  // Warning threshold (80% of max)
  const warningThreshold = Math.floor(maxTotalTokens * 0.8);

  return {
    maxInput,
    maxOutput,
    recommendedInput,
    recommendedOutput,
    warningThreshold,
  };
}

/**
 * Get GPU tier for user-friendly display
 */
export function getGPUTier(gpuCapabilities: GPUCapabilities | null): string {
  if (!gpuCapabilities) return 'Unknown';

  const vram = gpuCapabilities.estimatedVRAM;

  if (vram >= 8000) return 'High-end GPU (8GB+)';
  if (vram >= 4000) return 'Mid-range GPU (4-8GB)';
  if (vram >= 2000) return 'Entry-level GPU (2-4GB)';
  if (vram >= 1000) return 'Integrated GPU (1-2GB)';
  return 'Low-end GPU (<1GB)';
}

/**
 * Get user-friendly recommendations
 */
export function getTokenRecommendations(limits: TokenLimits): string[] {
  const recommendations: string[] = [];

  if (limits.maxInput < 1000) {
    recommendations.push('⚠️ Limited GPU memory detected. Keep conversations short.');
  } else if (limits.maxInput < 2000) {
    recommendations.push('💡 Moderate GPU memory. Suitable for standard chat.');
  } else if (limits.maxInput >= 4000) {
    recommendations.push('✨ High GPU memory. Can handle long conversations and context.');
  }

  recommendations.push(
    `📊 Recommended: ${limits.recommendedInput} input / ${limits.recommendedOutput} output tokens`
  );
  recommendations.push(`⚡ Max safe: ${limits.maxInput} input / ${limits.maxOutput} output tokens`);

  return recommendations;
}
