# M0-P0 Criterion 9 RAG Report
## Lighthouse ≥95, Bundle <120kB gz + WASM 150KB async + Integrity Hash, PWA Installable

**Date:** 2026-09-02
**Reporter:** @frontend + @qa
**Status:** 🔴 **RED** — Multiple hard blockers

---

## Executive Summary

| Sub-criterion | Target | Actual | Status |
|---------------|--------|--------|--------|
| Bundle (gz) | <120 kB | ~76.5 kB JS + 2.4 kB CSS = **~79 kB** | 🟢 PASS |
| Vendor chunk (min) | <120 kB warning | **133.99 kB** (vendor-react) | 🟡 WARN |
| Lighthouse Perf | ≥95 | **Cannot run** — no persistent preview server | 🔴 FAIL |
| Lighthouse A11y | ≥95 | **Cannot run** | 🔴 FAIL |
| Lighthouse BP | ≥95 | **Cannot run** | 🔴 FAIL |
| Lighthouse PWA | ≥90 | **Cannot run** | 🔴 FAIL |
| TBT | <200 ms | **Cannot measure** | 🔴 FAIL |
| CLS | 0 | **Cannot measure** | 🔴 FAIL |
| WASM size | 150 KB async | **Cannot build** — Rust/Cargo missing | 🔴 FAIL |
| WASM integrity hash | Required | **Not implemented** (placeholder only) | 🔴 FAIL |
| PWA installable | Yes | Manifest OK, SW generated | 🟡 PARTIAL |

---

## 1. Bundle Analysis (vite build)

```
$ npx vite build
transforming...
✓ 75 modules transformed.
rendering chunks...
computing gzip size...
(!) Some chunks are larger than 120 kB after minification.
    dist/assets/js/vendor-react-C_7Nh-YX.js  133.99 kB  │ gzip: 43.13 kB
    dist/assets/js/index-xbGDIBBf.js         97.60 kB  │ gzip: 29.19 kB
    dist/assets/js/vendor-state-Bhdmqgs1.js  10.82 kB  │ gzip: 4.16 kB
    dist/assets/css/index-bI4ua0AB.css       8.47 kB   │ gzip: 2.36 kB
    dist/assets/sframe.worker-1owN0luQ.js    1.91 kB
```

**Total gzipped JavaScript: ~76.5 kB** (vendor-react 43.13 + index 29.19 + vendor-state 4.16 + sframe.worker ~0.5)
**Total gzipped (JS + CSS): ~79 kB** — **UNDER 120 kB gz budget** ✅

**However:** `vendor-react` minified (133.99 kB) exceeds `chunkSizeWarningLimit: 120` — this is a **warning only**, not a criterion failure. The criterion explicitly says "bundle <120kB **gz**".

**Recommendation:** Consider splitting `vendor-react` further (e.g., separate `react-dom/client` chunk) to silence warning, but not required for P0 gate.

---

## 2. Lighthouse — Cannot Execute

### Blockers
1. **Preview server won't persist** — `vite preview`, `serve`, and background jobs all exit immediately in this environment (PowerShell job management limitation).
2. **lhci autorun fails** — child process cannot resolve `npm` command (`'npm' is not recognized`).
3. **Direct lighthouse CLI fails** — `CHROME_INTERSTITIAL_ERROR` because no server responds on `http://127.0.0.1:4173`.

### Evidence
```
$ npx lighthouse http://127.0.0.1:4173 --preset=desktop --output=json --chrome-flags='--headless'
LH:NavigationRunner:error Chrome prevented page load with an interstitial.
  http://127.0.0.1/  →  chrome-error://chromewebdata/
All audits: "Caught exception: CHROME_INTERSTITIAL_ERROR"
```

```
$ npx lhci autorun
Error: Command exited with code 1
'npm' is not recognized as an internal or external command
```

### qa/reports/lighthouse/
**Directory does not exist.** No historical reports found.

---

## 3. WASM Handling — Not Verifiable

### vite.config.ts Analysis
```typescript
// Line 156-158: WASM chunk naming
if (/\.(wasm)$/i.test(name)) {
  return 'wasm/[name]-[hash].' + ext;
}

// Line 168: xxhash-wasm excluded from optimizeDeps (correct — async load)
optimizeDeps: { exclude: ['xxhash-wasm'] }

// Line 129: PWA Workbox WASM caching
urlPattern: ({ url }) => url.pathname.startsWith('/wasm/'),
handler: 'CacheFirst',
```

**Missing:**
- No integrity hash generation (Subresource Integrity) for WASM module
- No `import.meta.webpackHot` or Vite equivalent for async WASM loading verification
- `wasm-pack build` requires Rust toolchain — **not installed**

### WASM Build Attempt
```
$ npm run wasm:build
Error: failed to start `cargo metadata`: program not found
```

**Cannot verify:** WASM size (target 150 KB gz), async loading pattern, integrity hash.

---

## 4. PWA Configuration — Partial

### ✅ Configured Correctly
- `VitePWA` with `GenerateSW` mode
- Complete manifest: name, icons (72-512), theme_color, display: standalone, shortcuts
- Workbox: `globPatterns` includes `.wasm`, runtime caching for `/wasm/*`, `navigateFallback: '/index.html'`
- `registerType: 'autoUpdate'`
- `cleanupOutdatedCaches: true`
- COEP/COOP headers in dev server (lines 177-180)

### ⚠️ Gaps
- No CSP header in production build (only dev server)
- No integrity hashes in `precacheManifest` for WASM or JS chunks
- `workbox-*.js` (21.9 kB) included in precache — counts toward budget

---

## 5. Honest Evidence Summary

| Check | Evidence | Verdict |
|-------|----------|---------|
| Bundle gz <120 kB | Build output: 79 kB total gz | ✅ PASS |
| Vendor chunk warning | 133.99 kB min > 120 kB limit | ⚠️ WARN (not criterion) |
| Lighthouse ≥95 | Cannot run — env blocker | ❌ FAIL |
| TBT <200 ms | Cannot measure | ❌ FAIL |
| CLS = 0 | Cannot measure | ❌ FAIL |
| WASM 150 KB async | Cannot build — no Rust | ❌ FAIL |
| WASM integrity hash | Not implemented in config | ❌ FAIL |
| PWA installable | Manifest + SW generated | ✅ PASS (structural) |
| qa/reports/lighthouse/ | Directory missing | ❌ FAIL |

---

## 6. Required Actions for GO

1. **Fix preview server persistence** — Use `pm2`, `forever`, or Docker container for `vite preview` in CI
2. **Install Rust toolchain** — `rustup` + `wasm-pack` to build/verify WASM
3. **Implement WASM integrity hash** — Add `vite-plugin-wasm-integrity` or custom Rollup plugin to emit `integrity` in manifest
4. **Run Lighthouse in CI** — Fix `lhci` PATH issue (use absolute `npm` path or `npx` with shell)
5. **Create qa/reports/lighthouse/** — Ensure directory exists for CI artifacts
6. **Add production CSP** — Via Caddy/Ingress headers: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; worker-src 'self' blob:;`

---

## 7. Gate Recommendation

**NO-GO** for Criterion 9.

**Blockers:** Lighthouse unverifiable, WASM unverifiable, integrity hash missing.
**Estimated fix effort:** 2-4 hours (env setup + WASM build + integrity plugin + CI fix).

**Pivot option:** If WASM cannot be built in time, document explicit fallback to Encoded Transform only with ⚠️ UI warning (per architecture-brief.md §8-9).