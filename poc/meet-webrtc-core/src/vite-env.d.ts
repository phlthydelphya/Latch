/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { UseBoundStore, StoreApi } from 'zustand';
import type { MeetingState, AppActions } from './store/appStore';

declare global {
  interface Window {
    __APP_STORE__?: UseBoundStore<StoreApi<MeetingState & AppActions>>;
    __WEBRTC_MANAGERS__?: Map<string, unknown>;
  }
}

declare module '*.svg' {
  import React from 'react';
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.wasm' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL: string;
  readonly VITE_TURN_URL: string;
  readonly PACKAGE_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}