import { CreateWebWorkerMLCEngine, type MLCEngineInterface } from '@mlc-ai/web-llm';
import type { ChatMessage } from './context';
import {
  detectGPUCapabilities,
  calculateTokenLimits,
  getGPUTier,
  getTokenRecommendations,
  type TokenLimits,
  type GPUCapabilities,
} from './token-config';
import { traceLogger } from '../utils/trace-logger';

export type ProgressUpdate = {
  progress: number;
  text: string;
};

export type GenerationOptions = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * LLM service wrapper for WebLLM engine running in a Web Worker.
 * Handles model initialization, streaming generation, and error handling.
 */
export class LLMService {
  private engine: MLCEngineInterface | null = null;
  private worker: Worker | null = null;
  private isReady: boolean = false;
  private abortController: AbortController | null = null;
  private tokenLimits: TokenLimits | null = null;
  private gpuCapabilities: GPUCapabilities | null = null;

  /**
   * Initialize the LLM engine with the specified model
   */
  async initModel(
    modelId: string = 'gemma-2-2b-it-q4f16_1-MLC',
    onProgress?: (update: ProgressUpdate) => void
  ): Promise<void> {
    try {
      // Detect GPU capabilities
      this.gpuCapabilities = await detectGPUCapabilities();

      // Calculate optimal token limits
      this.tokenLimits = calculateTokenLimits(modelId, this.gpuCapabilities);

      // Log GPU info and recommendations
      traceLogger.info('LLM', 'GPU Capabilities', this.gpuCapabilities);
      traceLogger.info('LLM', `GPU Tier: ${getGPUTier(this.gpuCapabilities)}`);
      traceLogger.info('LLM', 'Token Limits', this.tokenLimits);
      traceLogger.debug('LLM', 'Recommendations', getTokenRecommendations(this.tokenLimits));

      // Create worker
      this.worker = new Worker(new URL('./worker-llm.ts', import.meta.url), {
        type: 'module',
      });

      // Create engine with progress callback
      this.engine = await CreateWebWorkerMLCEngine(this.worker, modelId, {
        initProgressCallback: (report) => {
          if (onProgress) {
            onProgress({
              progress: report.progress,
              text: report.text,
            });
          }
        },
      });

      this.isReady = true;
    } catch (error) {
      this.isReady = false;
      throw new Error(
        `Failed to initialize model: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate a response with streaming
   */
  async generateResponse(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onUsage?: (usage: TokenUsage) => void,
    options: GenerationOptions = {}
  ): Promise<string> {
    if (!this.engine || !this.isReady) {
      throw new Error('Model not initialized. Call initModel() first.');
    }

    try {
      // Create abort controller for this generation
      this.abortController = new AbortController();

      // Use dynamic token limits if available
      const maxTokens = options.max_tokens ?? this.tokenLimits?.recommendedOutput ?? 1000;

      const chunks = await this.engine.chat.completions.create({
        messages,
        temperature: options.temperature ?? 0.8,
        top_p: options.top_p ?? 0.9,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      let fullReply = '';

      for await (const chunk of chunks) {
        // Check if generation was aborted
        if (this.abortController.signal.aborted) {
          break;
        }

        const delta = chunk.choices[0]?.delta.content || '';
        if (delta) {
          fullReply += delta;
          onToken(delta);
        }

        // Report usage from final chunk
        if (chunk.usage) {
          const usage: TokenUsage = {
            promptTokens: chunk.usage.prompt_tokens || 0,
            completionTokens: chunk.usage.completion_tokens || 0,
            totalTokens: chunk.usage.total_tokens || 0,
          };
          traceLogger.debug('LLM', 'Generation usage', usage);
          if (onUsage) {
            onUsage(usage);
          }
        }
      }

      return fullReply;
    } catch (error) {
      throw new Error(
        `Generation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Stop the current generation
   */
  stopGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Check if model is ready
   */
  isModelReady(): boolean {
    return this.isReady;
  }

  /**
   * Get current token limits
   */
  getTokenLimits(): TokenLimits | null {
    return this.tokenLimits;
  }

  /**
   * Get GPU capabilities
   */
  getGPUCapabilities(): GPUCapabilities | null {
    return this.gpuCapabilities;
  }

  /**
   * Get GPU tier description
   */
  getGPUTier(): string {
    return getGPUTier(this.gpuCapabilities);
  }

  /**
   * Get token recommendations
   */
  getRecommendations(): string[] {
    if (!this.tokenLimits) return [];
    return getTokenRecommendations(this.tokenLimits);
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.stopGeneration();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.engine = null;
    this.isReady = false;
  }
}

// Singleton instance
let llmServiceInstance: LLMService | null = null;

/**
 * Get the singleton LLM service instance
 */
export function getLLMService(): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService();
  }
  return llmServiceInstance;
}
