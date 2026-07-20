# PWA (Progressive Web App) Module

This directory contains all the code needed to make OffChat work **completely offline** as a Progressive Web App.

## What are Service Workers?

A **Service Worker** is a special JavaScript file that runs in the background, separate from your web page. Think of it as a "proxy" that sits between your app and the network.

### Why Do We Need Service Workers?

1. **Offline Functionality**: Cache files so the app works without internet
2. **Performance**: Load cached files instantly instead of downloading every time
3. **Background Updates**: Update cached files in the background
4. **Reliability**: App works even if the server is down

### How Service Workers Work

```
┌─────────────┐
│   Browser   │
│   (Your App)│
└──────┬──────┘
       │
       │ Request file (main.js, model files, etc.)
       ▼
┌─────────────────┐
│ Service Worker  │ ◄─── Intercepts ALL network requests
└──────┬──────────┘
       │
       │ Check: Is file in cache?
       │
    ┌──▼──┐
    │ YES │ ──► Return cached file (FAST!)
    └─────┘

    ┌──▼──┐
    │ NO  │ ──► Download from network → Save to cache → Return file
    └─────┘
```

## Files in this Directory

### `sw.ts` - The Service Worker

This is the **main service worker** that runs in the background. It uses [Workbox](https://developers.google.com/web/tools/workbox) to make caching easier.

**What it does:**

1. **Precaches** app files (HTML, CSS, JavaScript)
   - Files are cached during installation
   - App shell loads instantly on repeat visits

2. **Caches model files with `CacheFirst` strategy**
   - Model files: `.safetensors`, `.wasm`, `.bin`, `.json`
   - Once cached, **never refetch** (models don't change)
   - Stores in `models-v1` cache
   - Keeps files for 1 year

3. **Caches app assets with `StaleWhileRevalidate` strategy**
   - JavaScript, CSS, HTML files
   - Serves cached version immediately (fast)
   - Updates cache in background
   - User always gets newest version eventually

**Code breakdown:**

```typescript
// Cache model files - never refetch once cached
registerRoute(
  ({ url }) => url.pathname.endsWith('.safetensors') || ...,
  new CacheFirst({
    cacheName: 'models-v1',
    // Files stay cached for 1 year
  })
);

// Cache app assets - fast load + background update
registerRoute(
  ({ request }) => request.destination === 'script' || ...,
  new StaleWhileRevalidate({
    cacheName: 'assets-v1',
  })
);
```

### `register-sw.ts` - Service Worker Registration

This file **registers** the service worker when the app starts.

**What it does:**

1. **Registers** `/sw.js` with the browser
2. **Listens for updates** - when a new version is deployed
3. **Prompts user** to reload when update is available
4. **Handles activation** - takes control of the app

**Lifecycle:**

```
App starts → Register SW → SW installs → SW activates → SW controls page
                                ↓
                         Caches precache files
                                ↓
                         Ready for offline use!
```

### `storage.ts` - Persistent Storage Utilities

Manages **persistent storage** to prevent the browser from deleting cached files.

**Problem it solves:**

Browsers can evict (delete) cached data when storage is low. Model files are **1.2GB+**, so we need to prevent eviction.

**Functions:**

- `requestPersistence()` - Asks browser to never delete our cache
- `getStorageEstimate()` - Shows how much space is used/available
- `isStoragePersisted()` - Checks if persistence was granted
- `formatBytes()` - Formats bytes to human-readable (e.g., "1.2 GB")

**Example output:**

```javascript
{
  quota: 50_000_000_000,      // 50 GB total available
  usage: 1_400_000_000,       // 1.4 GB used (model files)
  percentUsed: 2.8            // 2.8% of quota
}
```

### `caching.ts` - Model Preloading

Utilities for **pre-downloading** model files before going offline.

**What it does:**

1. **Lists model URLs** that need to be cached
2. **Fetches each file** to trigger Service Worker caching
3. **Reports progress** (e.g., "Downloading 15/42 files, 72% complete")
4. **Checks if model is cached** before attempting to use offline

**Use case:**

User clicks "Preload Model" button → All model files download → Green checkmark "Ready for offline use"

## How They Work Together

### First Visit (Online):

```
1. User visits app
2. register-sw.ts registers Service Worker
3. sw.ts installs and caches app shell (HTML, CSS, JS)
4. storage.ts requests persistent storage
5. User waits for model to download (~1.2GB)
6. Model files flow through sw.ts → cached in models-v1
7. ✅ App ready for offline use
```

### Subsequent Visits (Offline):

```
1. User visits app (airplane mode)
2. sw.ts intercepts request for index.html
3. sw.ts returns cached HTML (instant!)
4. App loads JavaScript from cache
5. Model files loaded from cache (no download!)
6. 💬 User can chat completely offline
```

## Caching Strategies Explained

### `CacheFirst` (for model files)

```
Request → Check cache → Found? Return it
                      ↓ Not found?
                   Download → Cache → Return
```

**Why:** Model files are huge and never change. Once cached, always use cache.

### `StaleWhileRevalidate` (for app assets)

```
Request → Check cache → Found? Return it + Update in background
                      ↓ Not found?
                   Download → Cache → Return
```

**Why:** App code changes frequently. Show cached version (fast), but update for next time.

## Browser Support

- ✅ **Chrome/Edge 113+** (WebGPU required for LLM)
- ✅ **Desktop browsers** with service worker support
- ❌ **Safari** (no WebGPU as of 2025)
- ❌ **Firefox** (limited WebGPU support)

## Testing Offline Mode

### In Chrome DevTools:

1. Open DevTools (F12)
2. Go to **Application** tab
3. Click **Service Workers** - verify "activated and running"
4. Click **Cache Storage** - see `models-v1` and `assets-v1`
5. Go to **Network** tab
6. Check **Offline** checkbox
7. Reload page - app should still work!

### Testing Cache Size:

```javascript
// Run in browser console
const estimate = await navigator.storage.estimate();
console.log(`Using ${estimate.usage / 1e9} GB of ${estimate.quota / 1e9} GB`);
```

## Common Issues

### "Service worker registration failed"

**Cause:** HTTPS required (or localhost for dev)
**Fix:** Use `localhost` or deploy with HTTPS

### "Model files not caching"

**Cause:** Cache size limit exceeded
**Fix:** Check `vite.config.ts` → `maximumFileSizeToCacheInBytes` is set to 10MB+

### "App not working offline"

**Checklist:**
1. Service Worker registered? (DevTools → Application → Service Workers)
2. Files cached? (DevTools → Application → Cache Storage)
3. Model downloaded? (Look for "Model ready" in UI)
4. Persistent storage granted? (Check console logs)

## Development vs Production

### Development (`npm run dev`):

- Service Worker enabled in dev mode (`devOptions.enabled: true`)
- Uses `/dev-sw.js` for hot reload compatibility
- Cache updates automatically on code changes

### Production (`npm run build`):

- Optimized service worker (`/sw.js`)
- All files precached during build
- More aggressive caching (1-year expiry for models)

## Further Reading

- [Service Worker API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Workbox Documentation](https://developers.google.com/web/tools/workbox)
- [PWA Best Practices](https://web.dev/progressive-web-apps/)
- [Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API)

## Summary

**Service Workers** are the technology that makes OffChat work offline. They:

1. **Intercept network requests** (act as a proxy)
2. **Cache files** (models, app code, assets)
3. **Serve cached files** when offline
4. **Update caches** in the background

Without service workers, the app would need internet for every visit. With them, you can chat with a 2B parameter LLM **on an airplane** ✈️.
