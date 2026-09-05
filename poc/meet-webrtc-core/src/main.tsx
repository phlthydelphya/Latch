import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initSW } from './sw-register';
import { useAppStore } from './store/appStore';
import './styles/global.css';

// Expose the store for E2E test introspection (Playwright reads window.__APP_STORE__)
window.__APP_STORE__ = useAppStore;

// Initialize service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    initSW();
  });
}

// NOTE: StrictMode is intentionally omitted. Its dev-only double-invocation of
// effects re-runs useWebRTC's initialize(), creating a second RTCPeerConnection
// and a duplicate signaling session that breaks SDP negotiation (glare).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App />
  </BrowserRouter>
);