# UX-F1 Design Token Contract — Latch (meet-secure-core)

**Status:** DRAFT — Produced by Frontend Lead per PM charter UX-01 KICKOFF Phase 1
**Date:** 2026-09-11 (revised 2026-09-12 — palette unified to Latch brand kit v1.3, ink/lime/signal)
**Scope:** Single source of truth for all visual design decisions. Maps to brand story: **"Private by default, powerful when needed."**

---

## 1. Color Palette (Semantic Tokens)

| Token | Value | Usage | Contrast (WCAG AA) |
|-------|-------|-------|-------------------|
| **Background** |
| `bg-base` | `#070807` | Page background, deepest layer (latch-ink) | — |
| `bg-surface` | `#101210` | Cards, modals, drawers, toolbar (latch-ink-soft) | 18.3:1 on `fg-primary` |
| `bg-elevated` | `#171a16` | Hover states, active tabs, dropdowns | 16.1:1 on `fg-primary` |
| `bg-backdrop` | `rgba(0,0,0,0.75)` | Modal/drawer backdrop | N/A |
| **Foreground** |
| `fg-primary` | `#f4f5ee` | Primary text, headings (latch-paper) | 18.3:1 on `bg-base` |
| `fg-secondary` | `#d1d5ce` | Secondary text, descriptions | 13.5:1 on `bg-base` |
| `fg-muted` | `#a4aa9f` | Placeholders, disabled, meta (latch-muted) | 8.4:1 on `bg-base` (AA) |
| `fg-inverse` | `#070807` | Text on accent/primary backgrounds | — |
| **Accent / Brand** |
| `accent-primary` | `#b7ff2a` | **Primary actions, focus ring, speaking indicator, host accent** (latch-lime) | 15.6:1 on `bg-surface` |
| `accent-primary-hover` | `#d5ff78` | Hover state for primary buttons (latch-lime-hot) | — |
| `accent-primary-active` | `#9fdc22` | Active/pressed state | — |
| `accent-weak` | `rgba(183,255,42,0.15)` | **Subtle backgrounds: badges, banners, selection** | N/A |
| `accent-weak-border` | `rgba(183,255,42,0.4)` | Borders for accent containers | N/A |
| **Status / Semantic** |
| `success` | `#b7ff2a` | ✅ Connected, admitted, positive actions (shares accent per brand kit) | 15.6:1 on `bg-surface` |
| `info` | `#a79bff` | ℹ️ In-call chat, system messages, waiting badges (latch-signal) | 7.9:1 on `bg-surface` |
| `warning` | `#ffb020` | ⚠️ Hand raised, waiting room, reconnecting | 10.3:1 on `bg-surface` |
| `danger` | `#ff5b45` | 🚫 Errors, remove, locked room, mute-locked (latch-danger) | 6.1:1 on `bg-surface` |
| `danger-weak` | `rgba(255,91,69,0.15)` | Error backgrounds, locked badges | N/A |
| **Border / Divider** |
| `border-subtle` | `rgba(244,245,238,0.2)` | Default borders, dividers (latch-rule) | — |
| `border-strong` | `rgba(244,245,238,0.42)` | Focused inputs, active tabs (latch-rule-strong) | — |
| **Focus** |
| `focus-ring` | `#b7ff2a` | **Universal focus ring (2px solid + 2px offset)** | — |
| `focus-ring-inset` | `rgba(183,255,42,0.4)` | Inset focus for inputs | — |

### Color Usage Rules
1. **Never use raw hex** in components — only semantic tokens
2. `accent-primary` = **only interactive primary actions** (Join, Start, Admit, Copy Link)
3. `accent-weak` = **passive accent containers** (badges, banners, selection highlights)
4. `fg-muted` = **only for disabled/placeholder/meta** — never primary content
5. Status colors (`success`/`info`/`warning`/`danger`) **always paired with icon/text** — never color-only

---

## 2. Typography

| Token | Value | Usage |
|-------|-------|-------|
| `font-sans` | `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` | **All UI text, headings, buttons, inputs** |
| `font-mono` | `'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, monospace` | **Room IDs, keys, diagnostics, code blocks** |
| `font-display` | `'Arial Black', 'Helvetica Neue', Arial, sans-serif` | Landing hero, large headlines (weight 900, uppercase, `tracking-tight`) |

### Tracking (Brand Kit Additions)

| Token | Value | Usage |
|-------|-------|-------|
| `tracking-tight` | `-0.07em` | Display headlines, wordmark |
| `tracking-heading` | `-0.05em` | Section headings (uppercase display) |
| `tracking-label` | `0.12em` | Eyebrows, uppercase mono labels |

### Type Scale (Rem-based, 8px base)

| Token | Size | Line Height | Weight | Usage |
|-------|------|-------------|--------|-------|
| `text-xs` | `0.75rem` (12px) | 1.4 | 500 | Badges, timestamps, meta |
| `text-sm` | `0.8125rem` (13px) | 1.5 | 500 | Input labels, button text, captions |
| `text-base` | `0.875rem` (14px) | 1.5 | 400 | **Body text default** |
| `text-md` | `0.9375rem` (15px) | 1.5 | 500 | Emphasized body, modal titles |
| `text-lg` | `1rem` (16px) | 1.4 | 600 | Section headings, roster names |
| `text-xl` | `1.125rem` (18px) | 1.3 | 600 | Modal titles, page headings |
| `text-2xl` | `1.5rem` (24px) | 1.2 | 700 | Landing hero, meeting ready |
| `text-3xl` | `2rem` (32px) | 1.1 | 700 | Empty states, large icons |

### Typography Rules
1. **Inter** for all UI — geometric, legible at small sizes, modern neutral (no webfont download: system stack first)
2. **Display treatment** — `font-display` 900 uppercase with `tracking-tight`, per Latch brand kit v1.3
3. **JetBrains Mono** for all technical identifiers — room IDs, SFrame keys, diagnostics; eyebrow labels use `tracking-label` uppercase
4. **No font-weight below 400** — light weights fail contrast on dark backgrounds
5. **Line height ≥1.4** for body — ensures readability in dense meeting UI (display headlines may drop to 0.9–1.0)

---

## 3. Icon System — Phosphor Icons (Duotone Weight)

| Token | Value | Usage |
|-------|-------|-------|
| `icon-set` | `@phosphor-icons/react` (duotone) | **All iconography** |
| `icon-size-sm` | `16px` | Inline with `text-sm`, toolbar buttons |
| `icon-size-md` | `20px` | Inline with `text-base`, ControlBar media toggles |
| `icon-size-lg` | `24px` | Inline with `text-lg`, header logo, modal icons |
| `icon-size-xl` | `32px` | Feature pills, empty states, landing |
| `icon-stroke` | `1.5` (duotone inner) / `2` (outline) | Consistent stroke weight |

### Icon Mapping (Semantic → Phosphor)

| Semantic | Phosphor Duotone | Fallback (inline SVG) |
|----------|------------------|----------------------|
| `mic-on` | `MicrophoneStage` | Current inline SVG |
| `mic-off` | `MicrophoneSlash` | Current inline SVG |
| `cam-on` | `Camera` | Current inline SVG |
| `cam-off` | `CameraSlash` | Current inline SVG |
| `screen-share` | `MonitorPlay` | Current inline SVG |
| `hand-raise` | `HandRaised` | Current inline SVG |
| `chat` | `ChatText` | Current inline SVG |
| `participants` | `Users` | Current inline SVG |
| `settings` | `GearSix` | Current inline SVG |
| `diagnostics` | `ChartLineUp` | Current inline SVG |
| `leave` | `SignOut` | Current inline SVG |
| `pin` | `PushPinSimple` | Current inline SVG |
| `spotlight` | `Star` | Current inline SVG |
| `lock` | `LockKey` | Current inline SVG |
| `unlock` | `LockKeyOpen` | Current inline SVG |
| `shield` | `ShieldCheck` | Current inline SVG |
| `warning` | `WarningCircle` | Current inline SVG |
| `qr` | `QrCode` | Current inline SVG |
| `link` | `LinkSimple` | Current inline SVG |
| `copy` | `CopySimple` | Current inline SVG |
| `close` | `X` | Current inline SVG |
| `chevron-down` | `CaretDown` | Current inline SVG |
| `chevron-right` | `CaretRight` | Current inline SVG |

**Migration:** Replace all inline SVGs with Phosphor components in RFC primitive extraction

---

## 4. Motion & Animation Allowlist

### Approved Motion Tokens

| Token | Duration | Easing | Usage |
|-------|----------|--------|-------|
| `motion-instant` | `0ms` | — | `prefers-reduced-motion: reduce` |
| `motion-fade-100` | `100ms` | `ease-out` | Tooltip, popover, button hover |
| `motion-fade-150` | `150ms` | `ease-out` | **Default fade: modals, toolbars, badges, toasts** |
| `motion-fade-200` | `200ms` | `ease-out` | Drawers, larger overlays |
| `motion-slide-150` | `150ms` | `ease-out` | **Toolbar reveal, pip movement, badge appear** |
| `motion-slide-200` | `200ms` | `ease-out` | **Drawer slide, modal slide-up, content view transitions** |
| `motion-scale-100` | `100ms` | `ease-out` | Button press, tile hover scale |
| `motion-spring-200` | `200ms` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | PiP corner cycle, playful micro-interactions |
| `motion-brand-fast` | `160ms` | `cubic-bezier(0.22, 1, 0.36, 1)` | Brand-kit hover lifts, link transitions |
| `motion-brand-base` | `360ms` | `cubic-bezier(0.22, 1, 0.36, 1)` | Brand-kit section reveals, large surface transitions |

### Banned Animations (Do Not Use)
| Pattern | Reason |
|---------|--------|
| `transition: all` | Performance, unpredictable |
| `animation-iteration-count: infinite` (except loading spinners) | Distraction, accessibility |
| `cubic-bezier` with overshoot >1.2 (except `motion-spring-200`) | Jarring, reduces trust |
| `transform: translateZ(0)` / `will-change: transform` hacks | Unnecessary GPU layers |
| Keyframe animations >300ms | Feels sluggish in real-time UI |

### Motion Rules
1. **Every motion token respects `prefers-reduced-motion: reduce` → `motion-instant`**
2. **No layout-triggering animations** (width/height/top/left) — only `transform` + `opacity`
3. **Maximum 2 concurrent animations** per component — prevents jank
4. **Entrance animations only** — no exit animations (unmount is instant)
5. **Loading states** use `motion-fade-150` + skeleton, not spinners where possible

---

## 5. Shadows & Glow

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-1` | `0 1px 3px rgba(0,0,0,0.3)` | Inputs, chips, low elevation |
| `shadow-2` | `0 4px 12px rgba(0,0,0,0.4)` | **Toolbars, cards, VideoTile hover** |
| `shadow-3` | `0 8px 24px rgba(0,0,0,0.5)` | **Modals, drawers, dropdowns, PiP** |
| `shadow-4` | `0 20px 60px rgba(0,0,0,0.6)` | **Full-screen modals (Leave, HostControls)** |
| `glow-primary` | `0 0 0 2px var(--accent-primary), 0 0 16px rgba(183,255,42,0.3)` | **Speaking ring, focus ring, active primary** |
| `glow-warning` | `0 0 0 2px var(--warning), 0 0 12px rgba(255,176,32,0.4)` | Hand raised, reconnecting |
| `glow-danger` | `0 0 0 2px var(--danger), 0 0 12px rgba(255,91,69,0.4)` | Locked, muted-by-host, errors |
| `glow-spotlight` | `0 0 0 2px #eab308, 0 0 12px rgba(234,179,8,0.4)` | Spotlighted participant |

### Shadow Rules
1. **No `box-shadow` without token** — all shadows from this table
2. **Glow = semantic state** — never decorative
3. **Modal/drawer shadows include backdrop** — `shadow-3/4` + `bg-backdrop`
4. **VideoTile speaking ring** uses `glow-primary` (not custom)

---

## 6. Spacing & Rhythm

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | `4px` | Micro gaps, icon-text |
| `space-2` | `8px` | **Base unit — gaps, padding, margins** |
| `space-3` | `12px` | Component internal padding |
| `space-4` | `16px` | **Section gaps, modal padding, drawer padding** |
| `space-5` | `24px` | **Page rhythm — major section breaks** |
| `space-6` | `32px` | Landing hero, large modals |
| `space-7` | `48px` | Full-page sections |

### Rhythm Rules
1. **8pt grid** — all spacing multiples of `space-1` (4px)
2. **Vertical rhythm = 24px** (`space-5`) — aligns baselines across components
3. **Horizontal rhythm = 8px** (`space-2`) — toolbar gaps, tile gaps
4. **Component padding:** `space-4` (16px) standard, `space-3` (12px) compact
5. **Grid gap:** `space-2` (8px) — GalleryView, ContentView filmstrip

---

## 7. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | `4px` | Chips, badges, small buttons |
| `radius-md` | `8px` | **Buttons, inputs, cards, tiles, modals** |
| `radius-lg` | `12px` | VideoTile, ContentView stage, modals |
| `radius-xl` | `16px` | Modal containers, drawers |
| `radius-full` | `9999px` | Pills, avatar, toggle buttons |
| `radius-pill` | `24px` | ControlBar background, waiting room banner |

---

## 8. Z-Index Scale

| Token | Value | Usage |
|-------|-------|-------|
| `z-base` | `1` | Base content |
| `z-raised` | `10` | Gallery pagination, VideoTile badges |
| `z-sticky` | `50` | Header, ControlBar (when not auto-hidden) |
| `z-overlay` | `100` | Tooltips, popovers |
| `z-drawer` | `500` | RosterDrawer, ChatDrawer |
| `z-modal-backdrop` | `1000` | Modal backdrop |
| `z-modal` | `1050` | HostControlsModal, DeviceSettingsModal |
| `z-leave-modal` | `1100` | **LeaveConfirmationModal (highest — safety critical)** |
| `z-toast` | `1200` | ToastContainer |
| `z-pip` | `30` | PipPresenter (within stage) |

---

## 9. Breakpoints (Responsive)

| Token | Value | Usage |
|-------|-------|-------|
| `bp-sm` | `480px` | Mobile portrait — single column, stacked toolbar |
| `bp-md` | `768px` | Tablet — drawer width 320px, 2-col gallery |
| `bp-lg` | `1024px` | Desktop — full toolbar, 3-col gallery |
| `bp-xl` | `1440px` | Wide — 4-col gallery, side filmstrip |
| `bp-2xl` | `1920px` | Ultra-wide — 5-col gallery, max content width |

---

## 10. Implementation: `tokens.ts` + Stylelint Rule

### File: `poc/meet-webrtc-core/src/styles/tokens.ts`

```typescript
// ──────────────────────────────────────────────────────────────────────────────
// LATCH DESIGN TOKENS — Single source of truth for all visual design
// Generated from UX-F1 Design Token Contract
// ──────────────────────────────────────────────────────────────────────────────

export const tokens = {
  // Color
  color: {
    bg: {
      base: '#070807',
      surface: '#101210',
      elevated: '#171a16',
      backdrop: 'rgba(0,0,0,0.75)',
    },
    fg: {
      primary: '#f4f5ee',
      secondary: '#d1d5ce',
      muted: '#a4aa9f',
      inverse: '#070807',
    },
    accent: {
      primary: '#b7ff2a',
      primaryHover: '#d5ff78',
      primaryActive: '#9fdc22',
      weak: 'rgba(183,255,42,0.15)',
      weakBorder: 'rgba(183,255,42,0.4)',
    },
    status: {
      success: '#b7ff2a',
      info: '#a79bff',
      warning: '#ffb020',
      danger: '#ff5b45',
      dangerWeak: 'rgba(255,91,69,0.15)',
    },
    border: {
      subtle: 'rgba(244,245,238,0.2)',
      strong: 'rgba(244,245,238,0.42)',
    },
    focus: {
      ring: '#b7ff2a',
      ringInset: 'rgba(183,255,42,0.4)',
    },
  },

  // Typography
  font: {
    sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, monospace",
    display: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
  },
  tracking: {
    tight: '-0.07em',
    heading: '-0.05em',
    label: '0.12em',
  },
  text: {
    xs: { size: '0.75rem', lineHeight: '1.4', weight: '500' },
    sm: { size: '0.8125rem', lineHeight: '1.5', weight: '500' },
    base: { size: '0.875rem', lineHeight: '1.5', weight: '400' },
    md: { size: '0.9375rem', lineHeight: '1.5', weight: '500' },
    lg: { size: '1rem', lineHeight: '1.4', weight: '600' },
    xl: { size: '1.125rem', lineHeight: '1.3', weight: '600' },
    '2xl': { size: '1.5rem', lineHeight: '1.2', weight: '700' },
    '3xl': { size: '2rem', lineHeight: '1.1', weight: '700' },
  },

  // Icon
  icon: {
    size: { sm: '16px', md: '20px', lg: '24px', xl: '32px' },
    stroke: { duotone: '1.5', outline: '2' },
  },

  // Motion
  motion: {
    instant: '0ms',
    fade100: '100ms ease-out',
    fade150: '150ms ease-out',
    fade200: '200ms ease-out',
    slide150: '150ms ease-out',
    slide200: '200ms ease-out',
    scale100: '100ms ease-out',
    spring200: '200ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    brandFast: '160ms cubic-bezier(0.22, 1, 0.36, 1)',
    brandBase: '360ms cubic-bezier(0.22, 1, 0.36, 1)',
  },

  // Shadow & Glow
  shadow: {
    1: '0 1px 3px rgba(0,0,0,0.3)',
    2: '0 4px 12px rgba(0,0,0,0.4)',
    3: '0 8px 24px rgba(0,0,0,0.5)',
    4: '0 20px 60px rgba(0,0,0,0.6)',
  },
  glow: {
    primary: '0 0 0 2px var(--accent-primary), 0 0 16px rgba(183,255,42,0.3)',
    warning: '0 0 0 2px var(--warning), 0 0 12px rgba(255,176,32,0.4)',
    danger: '0 0 0 2px var(--danger), 0 0 12px rgba(255,91,69,0.4)',
    spotlight: '0 0 0 2px #eab308, 0 0 12px rgba(234,179,8,0.4)',
  },

  // Spacing
  space: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '24px',
    6: '32px',
    7: '48px',
  },

  // Border Radius
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
    pill: '24px',
  },

  // Z-Index
  z: {
    base: 1,
    raised: 10,
    sticky: 50,
    overlay: 100,
    drawer: 500,
    modalBackdrop: 1000,
    modal: 1050,
    leaveModal: 1100,
    toast: 1200,
    pip: 30,
  },

  // Breakpoints
  bp: {
    sm: '480px',
    md: '768px',
    lg: '1024px',
    xl: '1440px',
    '2xl': '1920px',
  },
} as const;

export type Tokens = typeof tokens;

// CSS Custom Properties Generator (for :root injection)
export function generateCSSVariables(): string {
  const lines: string[] = [':root {'];
  // Flatten tokens to CSS vars (abbreviated for brevity)
  // Full implementation in tokens.css.ts
  lines.push('}');
  return lines.join('\n');
}
```

### File: `poc/meet-webrtc-core/.stylelintrc.json` (Additions)

```json
{
  "rules": {
    "color-no-invalid-hex": true,
    "function-no-unknown": true,
    "unit-allowed-list": ["rem", "px", "ms", "s", "%", "deg", "fr", "em", "ch", "vh", "vw"],
    "color-hex-case": "lower",
    "color-hex-length": "short",
    "selector-class-pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$",
    "custom-property-pattern": "^(bg|fg|accent|status|border|focus|motion|shadow|glow|space|radius|z|bp|font|text|icon)-[a-z0-9-]+$",
    "declaration-property-value-allowed-list": {
      "background-color": ["/^var\\(--(bg|accent|status)-/", "transparent", "inherit"],
      "color": ["/^var\\(--(fg|accent|status)-/", "inherit"],
      "border-color": ["/^var\\(--(border|accent|status)-/", "transparent", "inherit"],
      "box-shadow": ["/^var\\(--(shadow|glow)-/", "none", "inherit"],
      "transition": ["/^var\\(--motion-/", "none", "inherit"],
      "animation": ["/^var\\(--motion-/", "none", "inherit"],
      "z-index": ["/^var\\(--z-/", "auto", "inherit"],
      "border-radius": ["/^var\\(--radius-/", "inherit"],
      "padding": ["/^var\\(--space-/", "inherit"],
      "margin": ["/^var\\(--space-/", "inherit"],
      "gap": ["/^var\\(--space-/", "inherit"],
      "font-family": ["/^var\\(--font-/", "inherit"],
      "font-size": ["/^var\\(--text-/", "inherit"],
      "line-height": ["/^var\\(--text-/", "inherit"],
      "font-weight": ["/^var\\(--text-/", "inherit"]
    }
  }
}
```

### File: `poc/meet-webrtc-core/src/styles/tokens.css.ts` (CSS Var Injection)

```typescript
import { tokens } from './tokens';

export function injectTokens(): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const setVar = (name: string, value: string) => root.style.setProperty(name, value);

  // Color
  Object.entries(tokens.color.bg).forEach(([k, v]) => setVar(`--bg-${k}`, v));
  Object.entries(tokens.color.fg).forEach(([k, v]) => setVar(`--fg-${k}`, v));
  Object.entries(tokens.color.accent).forEach(([k, v]) => setVar(`--accent-${k}`, v));
  Object.entries(tokens.color.status).forEach(([k, v]) => setVar(`--${k}`, v));
  Object.entries(tokens.color.border).forEach(([k, v]) => setVar(`--border-${k}`, v));
  Object.entries(tokens.color.focus).forEach(([k, v]) => setVar(`--focus-${k}`, v));

  // Typography
  setVar('--font-sans', tokens.font.sans);
  setVar('--font-mono', tokens.font.mono);
  setVar('--font-display', tokens.font.display);
  Object.entries(tokens.tracking).forEach(([k, v]) => setVar(`--tracking-${k}`, v));
  Object.entries(tokens.text).forEach(([k, v]) => {
    setVar(`--text-${k}-size`, v.size);
    setVar(`--text-${k}-line-height`, v.lineHeight);
    setVar(`--text-${k}-weight`, v.weight);
  });

  // Icon
  Object.entries(tokens.icon.size).forEach(([k, v]) => setVar(`--icon-size-${k}`, v));

  // Motion
  Object.entries(tokens.motion).forEach(([k, v]) => setVar(`--motion-${k}`, v));

  // Shadow & Glow
  Object.entries(tokens.shadow).forEach(([k, v]) => setVar(`--shadow-${k}`, v));
  Object.entries(tokens.glow).forEach(([k, v]) => setVar(`--glow-${k}`, v));

  // Spacing
  Object.entries(tokens.space).forEach(([k, v]) => setVar(`--space-${k}`, v));

  // Radius
  Object.entries(tokens.radius).forEach(([k, v]) => setVar(`--radius-${k}`, v));

  // Z-Index
  Object.entries(tokens.z).forEach(([k, v]) => setVar(`--z-${k}`, v));

  // Breakpoints (for JS media queries)
  Object.entries(tokens.bp).forEach(([k, v]) => setVar(`--bp-${k}`, v));
}
```

---

## 11. Brand Story Mapping

| Brand Pillar | Token Manifestation |
|--------------|---------------------|
| **Private by default** | `bg-base`/`bg-surface` = deep dark (no light leakage); `accent-weak` for passive E2EE badges; `fg-muted` for non-critical meta; no bright backgrounds |
| **Powerful when needed** | `accent-primary` = high-contrast lime for primary actions; `glow-primary` for speaking/focus; `motion-slide-150` for responsive feel; `shadow-4` for critical modals |
| **Calm under pressure** | Reduced motion respect; no infinite animations; `motion-fade-150` standard; `radius-md` softness; consistent 8pt rhythm |
| **Technical honesty** | `font-mono` for keys/IDs; `status` colors for real state (not marketing); `dtls-warning` explicit ⚠️; `e2ee-blind` bandwidth caption |

---

## 12. Migration Checklist

| Phase | Task | Status |
|-------|------|--------|
| 1 | Create `tokens.ts` + `tokens.css.ts` + inject in `main.tsx` | 📋 Planned |
| 2 | Add Stylelint rules + CI check | 📋 Planned |
| 3 | Replace inline styles in **ControlBar** (Toolbar RFC) | 📋 Planned |
| 4 | Replace inline styles in **LayoutControls** (ModeSwitcher RFC) | 📋 Planned |
| 5 | Replace inline styles in **VideoTile** (Card RFC) | 📋 Planned |
| 6 | Replace inline styles in **Modals** (Dialog RFC) | 📋 Planned |
| 7 | Replace inline styles in **Drawers** (Drawer RFC) | 📋 Planned |
| 8 | Replace inline SVGs with Phosphor icons | 📋 Planned |
| 9 | Add `prefers-reduced-motion` media query + `motion-instant` override | 📋 Planned |
| 10 | Audit all components for token compliance | 📋 Planned |