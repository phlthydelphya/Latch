import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react({
      jsxImportSource: 'react',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'meet-secure',
        short_name: 'meet',
        description: 'E2EE video conferencing — privacy by design',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-96.png',
            sizes: '96x96',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-144.png',
            sizes: '144x144',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-152.png',
            sizes: '152x152',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-384.png',
            sizes: '384x384',
            type: 'image/png',
            purpose: 'maskable any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable any',
          },
        ],
        categories: ['productivity', 'communication'],
        screenshots: [],
        shortcuts: [
          {
            name: 'New Meeting',
            short_name: 'New',
            description: 'Start a new secure meeting',
            url: '/r/new',
            icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        globIgnores: ['**/sw.js', '**/workbox-*.js'],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/wasm/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallback: '/index.html',
        navigateFallbackAllowlist: [/^\/r\//],
      },
      devOptions: {
        enabled: false,
        type: 'module',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-dom/client'],
          'vendor-state': ['zustand'],
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name || 'asset';
          const ext = name.split('.').pop() || '';
          if (/\.(png|jpe?g|gif|svg|ico|webp)$/i.test(name)) {
            return 'assets/img/[name]-[hash].' + ext;
          }
          if (/\.(woff2?)$/i.test(name)) {
            return 'assets/fonts/[name]-[hash].' + ext;
          }
          if (/\.(wasm)$/i.test(name)) {
            return 'wasm/[name]-[hash].' + ext;
          }
          return 'assets/[ext]/[name]-[hash].' + ext;
        },
      },
    },
    reportCompressedSize: true,
    chunkSizeWarningLimit: 120, // 120kB gz budget for main bundle
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'livekit-client'],
    exclude: ['xxhash-wasm'],
  },
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(process.env.npm_package_version),
  },
  server: {
    host: process.env.VITE_HOST ?? '0.0.0.0',
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    // DEV-ONLY parity with infra/Caddyfile (§2/4.1) — mirrors /signal→meet-signal:8080, /sfu|/rtc→livekit:7880, /turn→turn-auth:8082
    // Prod path is Caddy :443 (compose) / Ingress-Nginx (K8s) — no logic change to HRW SFU_NODES=livekit:7880 or stateless signal.
    // SECURITY: secure:false is DEV-ONLY — vite proxy only active in `vite dev` mode. Production uses Caddy TLS termination.
    // Override via VITE_HOST, VITE_SIGNAL_TARGET, VITE_SFU_TARGET, VITE_TURN_TARGET for test harness stability on Win32.
    proxy: {
      '/api': {
        target: process.env.VITE_SIGNAL_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      },
      '/token': {
        target: process.env.VITE_SIGNAL_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
        secure: false,
      },
      '/signal': {
        target: process.env.VITE_SIGNAL_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/sfu': {
        target: process.env.VITE_SFU_TARGET ?? 'http://127.0.0.1:7880',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/rtc': {
        target: process.env.VITE_SFU_TARGET ?? 'http://127.0.0.1:7880',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/turn': {
        target: process.env.VITE_TURN_TARGET ?? 'http://127.0.0.1:8082',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1', // DEV-ONLY — preview server binds IPv4 only; production uses Caddy TLS
    port: 4173,
    strictPort: true,
  },
});