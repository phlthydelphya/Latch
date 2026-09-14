// ──────────────────────────────────────────────────────────────────────────────
// LATCH DESIGN TOKENS — Single source of truth for all visual design
// Palette: Latch brand kit v1.3 (ink/lime/signal) — matches src/styles/global.css
// Contract: docs/ux/UX-F1-design-token-contract.md
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

// ──────────────────────────────────────────────────────────────────────────────
// CSS Custom Properties Generator (for :root injection)
// ──────────────────────────────────────────────────────────────────────────────

export function generateCSSVariables(): string {
  const lines: string[] = [':root {'];

  // Color
  Object.entries(tokens.color.bg).forEach(([k, v]) => lines.push(`  --bg-${k}: ${v};`));
  Object.entries(tokens.color.fg).forEach(([k, v]) => lines.push(`  --fg-${k}: ${v};`));
  Object.entries(tokens.color.accent).forEach(([k, v]) => lines.push(`  --accent-${k}: ${v};`));
  Object.entries(tokens.color.status).forEach(([k, v]) => lines.push(`  --${k}: ${v};`));
  Object.entries(tokens.color.border).forEach(([k, v]) => lines.push(`  --border-${k}: ${v};`));
  Object.entries(tokens.color.focus).forEach(([k, v]) => lines.push(`  --focus-${k}: ${v};`));

  // Typography
  lines.push(`  --font-sans: ${tokens.font.sans};`);
  lines.push(`  --font-mono: ${tokens.font.mono};`);
  lines.push(`  --font-display: ${tokens.font.display};`);
  Object.entries(tokens.tracking).forEach(([k, v]) => lines.push(`  --tracking-${k}: ${v};`));
  Object.entries(tokens.text).forEach(([k, v]) => {
    lines.push(`  --text-${k}-size: ${v.size};`);
    lines.push(`  --text-${k}-line-height: ${v.lineHeight};`);
    lines.push(`  --text-${k}-weight: ${v.weight};`);
  });

  // Icon
  Object.entries(tokens.icon.size).forEach(([k, v]) => lines.push(`  --icon-size-${k}: ${v};`));

  // Motion
  Object.entries(tokens.motion).forEach(([k, v]) => lines.push(`  --motion-${k}: ${v};`));

  // Shadow & Glow
  Object.entries(tokens.shadow).forEach(([k, v]) => lines.push(`  --shadow-${k}: ${v};`));
  Object.entries(tokens.glow).forEach(([k, v]) => lines.push(`  --glow-${k}: ${v};`));

  // Spacing
  Object.entries(tokens.space).forEach(([k, v]) => lines.push(`  --space-${k}: ${v};`));

  // Radius
  Object.entries(tokens.radius).forEach(([k, v]) => lines.push(`  --radius-${k}: ${v};`));

  // Z-Index
  Object.entries(tokens.z).forEach(([k, v]) => lines.push(`  --z-${k}: ${v};`));

  // Breakpoints (for JS media queries)
  Object.entries(tokens.bp).forEach(([k, v]) => lines.push(`  --bp-${k}: ${v};`));

  lines.push('}');
  return lines.join('\n');
}