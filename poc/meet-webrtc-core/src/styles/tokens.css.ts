import { tokens } from './tokens';

/**
 * Injects design tokens as CSS custom properties on the document root.
 * Call once at application startup (e.g., in main.tsx before React mounts).
 */
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
  Object.entries(tokens.z).forEach(([k, v]) => setVar(`--z-${k}`, String(v)));

  // Breakpoints (for JS media queries)
  Object.entries(tokens.bp).forEach(([k, v]) => setVar(`--bp-${k}`, v));
}

/**
 * Applies reduced-motion token overrides when user prefers reduced motion.
 * Call after injectTokens() or when media query changes.
 */
export function applyReducedMotion(): void {
  if (typeof window === 'undefined') return;

  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = (matches: boolean) => {
    const root = document.documentElement;
    if (matches) {
      // Override all motion tokens to instant
      Object.keys(tokens.motion).forEach((key) => {
        if (key !== 'instant') {
          root.style.setProperty(`--motion-${key}`, tokens.motion.instant);
        }
      });
    } else {
      // Restore original motion tokens
      Object.entries(tokens.motion).forEach(([k, v]) => {
        root.style.setProperty(`--motion-${k}`, v);
      });
    }
  };

  // Initial apply
  apply(mediaQuery.matches);

  // Listen for changes
  mediaQuery.addEventListener('change', (e) => apply(e.matches));
}

/**
 * Applies high-contrast token overrides when user prefers high contrast.
 * Call after injectTokens() or when media query changes.
 */
export function applyHighContrast(): void {
  if (typeof window === 'undefined') return;

  const mediaQuery = window.matchMedia('(prefers-contrast: high)');
  const apply = (matches: boolean) => {
    const root = document.documentElement;
    if (matches) {
      root.style.setProperty('--border-subtle', '#ffffff');
      root.style.setProperty('--fg-muted', '#cccccc');
      root.style.setProperty('--accent-primary', '#ccff70');
      root.style.setProperty('--danger', '#ff8a75');
      root.style.setProperty('--warning', '#ffcc00');
    } else {
      // Restore original values
      root.style.setProperty('--border-subtle', tokens.color.border.subtle);
      root.style.setProperty('--fg-muted', tokens.color.fg.muted);
      root.style.setProperty('--accent-primary', tokens.color.accent.primary);
      root.style.setProperty('--danger', tokens.color.status.danger);
      root.style.setProperty('--warning', tokens.color.status.warning);
    }
  };

  apply(mediaQuery.matches);
  mediaQuery.addEventListener('change', (e) => apply(e.matches));
}

/**
 * Initialize all token injections and media query listeners.
 * Call once at app startup.
 */
export function initTokens(): void {
  injectTokens();
  applyReducedMotion();
  applyHighContrast();
}