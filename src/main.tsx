import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import Chat from './components/Chat';
import { AppStateProvider } from './state/store';
import { db } from './db/db';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistence } from './pwa/storage';
import { initRetriever } from './embed/retriever';
import { traceLogger } from './utils/trace-logger';

// Register Service Worker
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    onNeedRefresh() {
      if (confirm('New version available! Reload to update?')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
      traceLogger.info('PWA', 'App ready to work offline');
    },
  });
}

// Request persistent storage (prevent eviction of large model files)
requestPersistence().then((granted) => {
  traceLogger.info('Storage', `Persistent storage: ${granted ? 'granted' : 'denied'}`);
});

// Initialize database
db.open()
  .then(() => {
    traceLogger.info('App', 'Database initialized successfully');
    return initRetriever();
  })
  .then(() => {
    traceLogger.info('App', 'Retriever initialized successfully');
  })
  .catch((err) => {
    traceLogger.error('App', 'Initialization failed', err);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider>
      <Chat />
    </AppStateProvider>
  </StrictMode>
);
