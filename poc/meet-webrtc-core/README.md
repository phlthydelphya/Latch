# meet-webrtc-core — M0-P0 PWA Shell

## Overview
Barebones PWA shell for M0-P0 criterion #9 verification. Implements allowed UX only:
`landing → /r/:id#k= → pre-join preview → grid Last-N=9 → mute/cam/leave + screen share + shield`

No breakouts, polls, reactions, whiteboard, virtual bg, captions, recording, webinar, anon links, P2P↔SFU handoff, WebTransport.

## Quick Start

```bash
# Install dependencies
npm --prefix poc/meet-webrtc-core install

# Development server
npm --prefix poc/meet-webrtc-core run dev

# Production build
npm --prefix poc/meet-webrtc-core run build

# Preview production build
npm --prefix poc/meet-webrtc-core run preview

# Run unit tests
npm --prefix poc/meet-webrtc-core run test

# Run E2E tests (4-browser matrix)
npm --prefix poc/meet-webrtc-core run test:browser

# Lighthouse CI
npm --prefix poc/meet-webrtc-core run lighthouse:ci

# Bundle analysis
npm --prefix poc/meet-webrtc-core run bundle:analyze
```

## PWA Verification Checklist (Criterion #9)

| Requirement | Target | Verification |
|-------------|--------|--------------|
| Lighthouse Performance | ≥95 | `npm run lighthouse:ci` |
| Lighthouse Accessibility | ≥95 | `npm run lighthouse:ci` |
| Lighthouse Best Practices | ≥95 | `npm run lighthouse:ci` |
| Lighthouse PWA | ≥90 | `npm run lighthouse:ci` |
| Bundle size (gz, no WASM) | <120kB | `npm run bundle:analyze` |
| WASM size (async) | 150kB | Check `dist/wasm/` |
| WASM integrity hash | Required | `vite-plugin-pwa` config |
| CSP `wasm-unsafe-eval` | Configured | `vite.config.ts` server headers |
| TBT | <200ms | Lighthouse report |
| CLS | 0 | Lighthouse report |
| FCP | <1.8s | Lighthouse report |
| LCP | <2.5s | Lighthouse report |
| Offline shell | Works | `page.context().setOffline(true)` |

## Commands for QA Reproduction

```bash
# 1. Clean install and build
npm --prefix poc/meet-webrtc-core ci
npm --prefix poc/meet-webrtc-core run build

# 2. Run unit tests
npm --prefix poc/meet-webrtc-core run test

# 3. Start preview server (for Lighthouse)
npm --prefix poc/meet-webrtc-core run preview &
PREVIEW_PID=$!

# 4. Run Lighthouse CI
npm --prefix poc/meet-webrtc-core run lighthouse:ci

# 5. Run browser matrix tests
npm --prefix poc/meet-webrtc-core run test:browser

# 6. Kill preview
kill $PREVIEW_PID
```

## Project Structure

```
poc/meet-webrtc-core/
├── public/
│   ├── manifest.webmanifest      # PWA manifest
│   ├── sw.js                     # Service worker (Workbox)
│   ├── offline.html              # Offline fallback
│   ├── favicon.svg
│   ├── icon.svg
│   └── icons/                    # PNG icons (72-512px)
├── src/
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Router + ErrorBoundary
│   ├── vite-env.d.ts
│   ├── styles/
│   │   └── global.css            # Design system
│   ├── store/
│   │   └── appStore.ts           # Zustand store
│   ├── hooks/
│   │   ├── useMediaDevices.ts    # getUserMedia + enumeration
│   │   ├── useWebRTC.ts          # WebRTCManager integration
│   │   └── useAudioLevel.ts      # Audio level monitoring
│   ├── components/
│   │   ├── ErrorBoundary.tsx
│   │   ├── LoadingScreen.tsx
│   │   ├── VideoGrid.tsx
│   │   ├── VideoTile.tsx
│   │   ├── ControlBar.tsx
│   │   ├── ShieldBadge.tsx
│   │   └── ConnectionIndicator.tsx
│   ├── pages/
│   │   ├── LandingPage.tsx
│   │   ├── PreJoinPage.tsx
│   │   └── MeetingPage.tsx
│   ├── workers/
│   │   └── sframe.worker.ts      # WASM SFrame worker
│   ├── sw-register.ts            # SW registration
│   └── index.ts                  # Core exports (existing)
├── wasm/
│   └── sframe/                   # Rust WASM source
├── tests/
│   ├── setup.ts                  # Vitest mocks
│   ├── app.test.tsx              # Unit tests
│   └── e2e/
│       └── pwa.spec.ts           # Playwright tests
├── vite.config.ts                # Vite + PWA + Workbox
├── vitest.config.ts
├── playwright.config.ts
├── lighthouserc.json             # Lighthouse CI config
├── tsconfig.json
├── tsconfig.app.json
└── package.json
```

## Key Implementation Details

### Service Worker (Workbox GenerateSW)
- **Strategy**: `autoUpdate` with `navigateFallback: /index.html`
- **Caching**: Cache-first for assets, network-first for HTML
- **WASM**: Separate cache with 30-day expiry
- **Offline**: `offline.html` fallback

### Manifest
- `display: standalone`
- `theme_color: #0a0a0f`
- Maskable icons at 72, 96, 128, 144, 152, 192, 384, 512
- Shortcuts: "New Meeting"

### Bundle Budget
- Manual chunks: `vendor-react`, `vendor-state`, `vendor-webrtc`, `vendor-crypto`, `vendor-utils`
- `chunkSizeWarningLimit: 120` (kB gz)
- Dynamic imports for heavy deps (`@mls-ts/mls`, `hpke`, `sframe`, `xxhash-wasm`)

### WASM SFrame
- Rust crate in `wasm/sframe/` (target 150KB gz)
- OffscreenCanvas worker with VideoFrame recycling
- Integrity hash in `vite.config.ts` + worker fetch
- CSP: `script-src 'self' 'wasm-unsafe-eval'`

### Accessibility
- Skip link
- ARIA labels on all controls
- Live regions for connection status
- Focus visible outlines
- Reduced motion support
- High contrast support

## Environment Variables

Create `.env` in `poc/meet-webrtc-core/`:

```env
VITE_SIGNALING_URL=wss://localhost:8080/signal
VITE_TURN_URL=https://localhost:8082/turn
```

## Lighthouse CI Output

Reports saved to `qa/reports/lighthouse/`:
- `lighthouse-report.json` — full report
- `lighthouse-report.html` — HTML view

## Troubleshooting

**Service worker not registering**: Check `vite.config.ts` `devOptions.enabled: false` — SW only works in production preview.

**WASM not loading**: Ensure `wasm-pack` installed and `npm run wasm:build` ran. Check CSP allows `wasm-unsafe-eval`.

**Lighthouse fails**: Run `npm run preview` first, then `lhci autorun`. Ensure no other process on port 4173.

**Playwright browsers missing**: Run `npx playwright install --with-deps chromium firefox webkit`