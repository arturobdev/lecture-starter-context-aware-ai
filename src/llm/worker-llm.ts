import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// Create handler for WebWorker communication
const handler = new WebWorkerMLCEngineHandler();

// Handle messages from main thread
self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
