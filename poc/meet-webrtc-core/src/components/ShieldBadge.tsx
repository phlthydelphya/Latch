import { useAppStore } from '../store/appStore';

export type ShieldState = 'e2ee' | 'e2ee-blind' | 'dtls-warning' | 'reconnecting' | 'disconnected';

export function ShieldBadge({ state, participantCount }: { state?: ShieldState; participantCount?: number }) {
  const shieldMode = useAppStore((s) => s.shieldMode);
  const isConnected = useAppStore((s) => s.isConnected);
  const isReconnecting = useAppStore((s) => s.isReconnecting);

  // P0 honest E2EE states:
  // - e2ee: SFrame active, header-aware (ideal)
  // - e2ee-blind: SFrame active but blind-forward 3 layers (≤20p Last-N=9) — honest fallback per ADR-002
  // - dtls-warning: SFrame unavailable → explicit ⚠️ DTLS-only, no silent downgrade (M0-P0 crit 1/4)
  // Derived state if not passed: use store
  const derived: ShieldState = state ?? (isReconnecting ? 'reconnecting' : shieldMode ? (participantCount && participantCount > 12 ? 'e2ee-blind' : 'e2ee') : 'disconnected');

  if (derived === 'disconnected') return null;

  const labels: Record<ShieldState, { text: string; aria: string; warning?: boolean }> = {
    'e2ee': { text: 'E2EE · SFrame', aria: 'End-to-end encryption active via SFrame' },
    'e2ee-blind': { text: 'E2EE · 3-layer relay', aria: 'End-to-end encryption active, 3-layer relay high bandwidth mode' },
    'dtls-warning': { text: '⚠️ DTLS-only — E2EE unavailable', aria: 'Warning: end-to-end encryption unavailable, DTLS only' , warning: true },
    'reconnecting': { text: 'E2EE · Reconnecting…', aria: 'End-to-end encryption active, reconnecting' },
    'disconnected': { text: '', aria: '' },
  };
  const cfg = labels[derived];

  return (
    <div className={`shield-badge ${cfg.warning ? 'shield-warning' : ''}`} role={cfg.warning ? 'alert' : 'status'} aria-live="polite" aria-label={cfg.aria}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        {derived === 'reconnecting' && <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />}
        {cfg.warning && <text x="12" y="16" textAnchor="middle" fontSize="14" fill="currentColor">!</text>}
      </svg>
      <span>{cfg.text}</span>
      {derived === 'e2ee-blind' && participantCount && participantCount > 9 && (
        <small className="shield-caption">High bandwidth ~10 Mbps · Last-N=9</small>
      )}
    </div>
  );
}