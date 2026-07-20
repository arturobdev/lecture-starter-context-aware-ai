import { Workbox } from 'workbox-window';
import { traceLogger } from '../utils/trace-logger';

let wb: Workbox | null = null;

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    traceLogger.warn('PWA', 'Service Worker not supported');
    return;
  }

  wb = new Workbox('/sw.js');

  // Listen for updates
  wb.addEventListener('waiting', () => {
    traceLogger.info('PWA', 'New service worker waiting');
    // Show update notification (can be connected to UI later)
    const update = confirm(
      'New version available! Reload to update?'
    );
    if (update) {
      wb?.messageSkipWaiting();
      window.location.reload();
    }
  });

  wb.addEventListener('controlling', () => {
    traceLogger.info('PWA', 'Service worker controlling');
    window.location.reload();
  });

  wb.addEventListener('activated', (event) => {
    traceLogger.info('PWA', 'Service worker activated', event);
  });

  try {
    const registration = await wb.register();
    traceLogger.info('PWA', 'Service Worker registered', registration);
  } catch (error) {
    traceLogger.error('PWA', 'Service Worker registration failed', error);
  }
}

export function getWorkbox(): Workbox | null {
  return wb;
}
