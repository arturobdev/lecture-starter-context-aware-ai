/**
 * Persistent storage utilities for PWA
 */

import { traceLogger } from '../utils/trace-logger';

export interface StorageEstimate {
  quota?: number;
  usage?: number;
  percentUsed?: number;
}

/**
 * Request persistent storage to prevent eviction
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage || !navigator.storage.persist) {
    traceLogger.warn('Storage', 'Persistent storage API not available');
    return false;
  }

  try {
    const isPersisted = await navigator.storage.persist();
    traceLogger.info(
      'Storage',
      `Persistent storage ${isPersisted ? 'granted' : 'denied'}`
    );
    return isPersisted;
  } catch (error) {
    traceLogger.error('Storage', 'Failed to request persistent storage', error);
    return false;
  }
}

/**
 * Get current storage quota and usage
 */
export async function getStorageEstimate(): Promise<StorageEstimate> {
  if (!navigator.storage || !navigator.storage.estimate) {
    traceLogger.warn('Storage', 'Storage estimate API not available');
    return {};
  }

  try {
    const estimate = await navigator.storage.estimate();
    const quota = estimate.quota || 0;
    const usage = estimate.usage || 0;
    const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;

    return {
      quota,
      usage,
      percentUsed,
    };
  } catch (error) {
    traceLogger.error('Storage', 'Failed to get storage estimate', error);
    return {};
  }
}

/**
 * Check if storage is persisted
 */
export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage || !navigator.storage.persisted) {
    return false;
  }

  try {
    return await navigator.storage.persisted();
  } catch (error) {
    traceLogger.error('Storage', 'Failed to check storage persistence', error);
    return false;
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
