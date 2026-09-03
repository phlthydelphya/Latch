import { useAppStore } from '../store/appStore';

export function ConnectionIndicator() {
  const quality = useAppStore((s) => s.connectionQuality);
  const isReconnecting = useAppStore((s) => s.isReconnecting);

  const labels = {
    excellent: 'Excellent connection',
    good: 'Good connection',
    poor: 'Poor connection',
    disconnected: 'Disconnected',
  };

  const colors = {
    excellent: '#00d4aa',
    good: '#74b9ff',
    poor: '#ffa502',
    disconnected: '#ff4757',
  };

  const color = colors[quality];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.5rem',
        borderRadius: '999px',
        background: `${color}20`,
        border: `1px solid ${color}`,
        color: color,
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
      role="status"
      aria-live="polite"
      aria-label={isReconnecting ? 'Reconnecting…' : labels[quality]}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: color,
          animation: isReconnecting || quality === 'poor' ? 'pulse 1s infinite' : 'none',
        }}
        aria-hidden="true"
      />
      {isReconnecting ? 'Reconnecting…' : quality.charAt(0).toUpperCase() + quality.slice(1)}
    </div>
  );
}