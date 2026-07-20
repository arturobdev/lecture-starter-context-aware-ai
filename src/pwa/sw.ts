/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope;

// Take control immediately
clientsClaim();

// Precache app shell
precacheAndRoute(self.__WB_MANIFEST);

// Cache model files with CacheFirst (never refetch once cached)
registerRoute(
  // Match model files: safetensors, WASM, JSON configs
  ({ url }) => {
    const pathname = url.pathname;
    return (
      pathname.endsWith('.safetensors') ||
      pathname.includes('wasm-runtime') ||
      pathname.includes('mlc-chat-config.json') ||
      pathname.includes('tokenizer') ||
      pathname.endsWith('.wasm') ||
      pathname.endsWith('.bin')
    );
  },
  new CacheFirst({
    cacheName: 'models-v1',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200], // 0 for opaque responses
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
      }),
    ],
  })
);

// Cache app assets with StaleWhileRevalidate (fast load, background update)
registerRoute(
  ({ request }) => {
    return (
      request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'document'
    );
  },
  new StaleWhileRevalidate({
    cacheName: 'assets-v1',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  })
);

// Listen for skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
