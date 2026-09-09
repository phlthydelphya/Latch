import { useDeviceStore } from '../../devices/deviceStore';

export function MicLevelMeter() {
  const level = useDeviceStore((s) => s.micLevel);

  // Compute segmented bar color
  const color =
    level > 85 ? 'var(--danger, #ff4757)' : level > 60 ? 'var(--warning, #ffa502)' : 'var(--accent, #00d4aa)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted, #888899)' }}>Input Level</span>
        <span
          style={{
            fontSize: '0.75rem',
            fontFamily: 'var(--font-mono, monospace)',
            color: level > 85 ? 'var(--danger, #ff4757)' : 'var(--fg-muted, #888899)',
          }}
        >
          {level > 85 ? 'High (Clipping)' : `${level}%`}
        </span>
      </div>

      <div
        role="meter"
        aria-label="Microphone input volume"
        aria-valuenow={level}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: '8px',
          width: '100%',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          borderRadius: '4px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${level}%`,
            backgroundColor: color,
            transition: 'width 60ms ease-out, background-color 150ms ease',
            borderRadius: '4px',
          }}
        />
      </div>
    </div>
  );
}
