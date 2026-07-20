# OffChat — Context-Aware AI homework starter

A 100% client-side, offline-capable PWA: an "infinite" chat with a **local LLM** (WebGPU), **semantic memory retrieval**, and **persistent local storage**. After the first model download everything runs in the browser — no backend, no API keys, no per-token cost, no data leaving the device.

> **This is the homework starter** for the Binary Studio Academy **Context-Aware AI** lecture. The context-engineering core has been removed and left as `TODO(student)` stubs. Implement them so the chat actually remembers, then commit the result to **your own public repository**. The lecture explains each piece as pseudocode — write the real TypeScript yourself.

## Your task

Implement the `TODO(student)` stubs in these files (the lecture materials explain each one):

1. **`src/utils/tokens.ts`** — token budgeting: estimate token counts, split the context window into per-section allowances, trim to fit, decide when to summarize.
2. **`src/embed/retriever.ts`** — retrieval scoring: `cosineSimilarity`, `calculateRecencyBoost`, `calculateCombinedScore` (used by `retrieveRelevant`).
3. **`src/llm/context.ts`** — `assembleContext`: build the prompt (system → rolling summary → retrieved snippets → recent buffer) within the token budget, de-dup by timestamp, trim gracefully. _(The capstone.)_

Implement in order: `tokens.ts` → scoring → `assembleContext`. Keep the **Memory Inspector** panel open while you work — it shows what was retrieved and what was sent to the model. Optional bonus tasks (extra points) are listed in the lecture homework.

## Features

- Local LLM inference via **WebLLM** (`@mlc-ai/web-llm`) on WebGPU, in a Web Worker.
- Local text **embeddings** via **transformers.js** (`@huggingface/transformers`).
- In-browser **vector index** (HNSW) via **hnswlib-wasm**.
- Three-tier memory — recent buffer + rolling summary + semantic retrieval — assembled within a token budget.
- Persistent storage via **Dexie / IndexedDB**; offline support via a service worker (vite-plugin-pwa).
- A **Memory Inspector** panel that visualizes what was retrieved and what was sent to the model.

## Tech stack

React 19 · TypeScript · Vite · `@mlc-ai/web-llm` · `@huggingface/transformers` · `hnswlib-wasm` · `dexie` · vite-plugin-pwa (Workbox) · Vitest.

## Requirements

- **Chrome or Edge 113+** — WebGPU is required for the LLM (Safari/Firefox are not supported).
- The default model (`gemma-2-2b`) downloads ~1.2 GB on first run, then is cached for offline use.

## Getting started

```sh
npm install
npm run dev      # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`, `npm run lint`, `npm run test`.

> A production `npm run build` currently needs the Workbox precache size limit in `vite.config.ts` raised above the ~21.6 MB ONNX-runtime WASM (or that file excluded from precache).

## Project structure

```
src/
  components/   Chat UI + Memory Inspector
  llm/          WebLLM worker, context assembly, summary, facts, prompts, token config
  embed/        embeddings worker, HNSW index, retriever
  memory/       memory orchestration (read/write paths)
  db/           Dexie schema + operations
  state/        React Context store
  pwa/          service worker + storage helpers
  utils/        token budgeting, trace logger
```

## How it works (one turn)

On each user message: summarize old turns if needed → retrieve relevant past snippets → assemble the prompt context (system + summary + snippets + recent buffer) within the token budget → stream the reply. Afterwards, in the background: embed the new messages and extract durable facts.

The memory model, WebGPU specifics, and browser support are covered in depth in the lecture materials.
