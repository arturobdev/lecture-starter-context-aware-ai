/**
 * MVP Traceability Logger
 *
 * Provides detailed logging for development and debugging during MVP phase.
 * Tracks embeddings, ANN operations, and retrieval for transparency.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TraceEvent {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

class TraceLogger {
  private events: TraceEvent[] = [];
  private maxEvents = 1000; // Keep last 1000 events in memory
  private enabled = true; // Enable by default in MVP

  log(level: LogLevel, category: string, message: string, data?: unknown): void {
    if (!this.enabled) return;

    const event: TraceEvent = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
    };

    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Console output with color coding
    const prefix = `[${category}]`;
    const msg = `${message}`;

    switch (level) {
      case 'debug':
        console.debug(prefix, msg, data ?? '');
        break;
      case 'info':
        console.info(prefix, msg, data ?? '');
        break;
      case 'warn':
        console.warn(prefix, msg, data ?? '');
        break;
      case 'error':
        console.error(prefix, msg, data ?? '');
        break;
    }
  }

  debug(category: string, message: string, data?: unknown): void {
    this.log('debug', category, message, data);
  }

  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }

  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }

  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }

  getEvents(category?: string, level?: LogLevel): TraceEvent[] {
    let filtered = this.events;

    if (category) {
      filtered = filtered.filter(e => e.category === category);
    }

    if (level) {
      filtered = filtered.filter(e => e.level === level);
    }

    return filtered;
  }

  clear(): void {
    this.events = [];
    this.info('TraceLogger', 'Event log cleared');
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
export const traceLogger = new TraceLogger();
