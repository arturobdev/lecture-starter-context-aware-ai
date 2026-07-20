// System prompt for chat
export const SYSTEM_PROMPT = `You are a helpful, concise assistant. Use the provided conversation context to answer questions accurately. If you're unsure about something, say so clearly.`;

// Prompt for generating rolling summaries (future use in Phase 5)
export const SUMMARY_PROMPT = `Summarize the following chat turns into terse bullet points, retaining key decisions, tasks, user preferences, names, and dates. Be compact and factual.`;

// Prompt for extracting facts (future use in Phase 5)
export const FACTS_PROMPT = `Extract durable user/assistant facts (name, preferences, goals, constraints, TODOs). Return key:value pairs as bullet points.`;
