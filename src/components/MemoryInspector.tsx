/**
 * Memory Inspector Component
 *
 * Displays memory system state for debugging and transparency:
 * - Rolling summary
 * - Retrieved snippets
 * - Extracted facts
 * - Token budget usage
 */

import { useState, useEffect, memo } from 'react';
import { useAppState } from '../state/store';
import { getLatestSummary } from '../llm/summary';
import { getThreadFacts, formatFacts } from '../llm/facts';
import { getLastRetrievalResults } from '../memory/memory-manager';
import { calculateTokenBudget, estimateTokens, getTokenStats } from '../utils/tokens';
import { type Fact } from '../db/db';

function MemoryInspector() {
  const { currentThreadId, maxInputTokens, memoryStats } = useAppState();
  const [summary, setSummary] = useState<string | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load summary and facts when stats change (event-driven updates)
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load summary
        const latestSummary = await getLatestSummary(currentThreadId);
        setSummary(latestSummary?.text || null);

        // Load facts
        const threadFacts = await getThreadFacts(currentThreadId);
        setFacts(threadFacts);

        setLoading(false);
      } catch (err) {
        console.error('Failed to load memory data', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    loadData();
  }, [currentThreadId, memoryStats.factCount, memoryStats.summaryCount]);

  // Get last retrieval results
  const retrievedSnippets = getLastRetrievalResults();

  // Calculate token budget using actual maxInputTokens from app state
  const budget = calculateTokenBudget(maxInputTokens);
  const summaryTokens = summary ? estimateTokens(summary) : 0;
  const summaryStats = getTokenStats(summaryTokens, budget.summary);

  return (
    <div className="memory-inspector">
      <div className="inspector-header">
        <h3>🧠 Memory Inspector</h3>
      </div>

      <div className="inspector-content">
        {loading && <div className="empty-state">Loading memory data...</div>}
        {error && <div className="empty-state" style={{ color: '#f87171' }}>Error: {error}</div>}

        {!loading && !error && (
          <>
            {/* Memory Statistics */}
            <div className="inspector-section">
              <h4>📊 Memory Statistics</h4>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">Messages:</span>
                  <span className="stat-value">{memoryStats.messageCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Embeddings:</span>
                  <span className="stat-value">{memoryStats.embeddingCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Summaries:</span>
                  <span className="stat-value">{memoryStats.summaryCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Facts:</span>
                  <span className="stat-value">{memoryStats.factCount}</span>
                </div>
              </div>
            </div>

            {/* Rolling Summary */}
            <div className="inspector-section">
              <h4>
                📝 Rolling Summary
                {summary && (
                  <span className="token-count">
                    ({summaryTokens} tokens, {summaryStats.percentage}% of budget)
                  </span>
                )}
              </h4>
              {summary ? (
                <div className="summary-content">{summary}</div>
              ) : (
                <div className="empty-state">No summary yet. Summary will be generated automatically when conversation grows.</div>
              )}
            </div>

            {/* Retrieved Snippets */}
            <div className="inspector-section">
              <h4>🔍 Last Retrieved Snippets ({retrievedSnippets.length})</h4>
              {retrievedSnippets.length > 0 ? (
                <div className="snippets-list">
                  {retrievedSnippets.map((result, idx) => (
                    <div key={idx} className="snippet-item">
                      <div className="snippet-header">
                        <span className="snippet-index">#{idx + 1}</span>
                        <span className="snippet-score">
                          Score: {result.score.toFixed(3)}
                        </span>
                        <span className="snippet-time">
                          {new Date(result.message.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="snippet-text">
                        <strong>{result.message.role}:</strong> {result.message.text}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">No snippets retrieved yet. Retrieved context will appear here when you ask questions.</div>
              )}
            </div>

            {/* Extracted Facts */}
            <div className="inspector-section">
              <h4>💡 Extracted Facts ({facts.length})</h4>
              {facts.length > 0 ? (
                <div className="facts-content">
                  <pre>{formatFacts(facts)}</pre>
                </div>
              ) : (
                <div className="empty-state">No facts extracted yet. Facts will be extracted automatically from conversations.</div>
              )}
            </div>

            {/* Token Budget */}
            <div className="inspector-section">
              <h4>⚡ Token Budget Allocation</h4>
              <div className="budget-grid">
                <div className="budget-item">
                  <span className="budget-label">System Prompt:</span>
                  <span className="budget-value">{budget.systemPrompt} tokens (5%)</span>
                </div>
                <div className="budget-item">
                  <span className="budget-label">Summary:</span>
                  <span className="budget-value">{budget.summary} tokens (15%)</span>
                </div>
                <div className="budget-item">
                  <span className="budget-label">Retrieval:</span>
                  <span className="budget-value">{budget.retrieval} tokens (20%)</span>
                </div>
                <div className="budget-item">
                  <span className="budget-label">Buffer:</span>
                  <span className="budget-value">{budget.buffer} tokens (50%)</span>
                </div>
                <div className="budget-item">
                  <span className="budget-label">User Reserve:</span>
                  <span className="budget-value">{budget.userMessageReserve} tokens (10%)</span>
                </div>
                <div className="budget-item">
                  <span className="budget-label">Total:</span>
                  <span className="budget-value">{budget.total} tokens</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(MemoryInspector);
