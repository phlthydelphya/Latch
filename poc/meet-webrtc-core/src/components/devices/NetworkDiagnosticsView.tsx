import { useEffect, useState } from 'react';
import { generateDiagnosticBundle, downloadDiagnosticBundle, SanitizedDiagnosticBundle } from '../../utils/diagnostics';
import { useAppStore } from '../../store/appStore';

export function NetworkDiagnosticsView() {
  const [bundle, setBundle] = useState<SanitizedDiagnosticBundle | null>(null);
  const isConnected = useAppStore((s) => s.isConnected);
  const connectionQuality = useAppStore((s) => s.connectionQuality);

  useEffect(() => {
    let isMounted = true;

    async function fetchStats() {
      try {
        const data = await generateDiagnosticBundle();
        if (isMounted) {
          setBundle(data);
        }
      } catch (err) {
        console.warn('[NetworkDiagnostics] Failed to collect diagnostic bundle:', err);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const stats = bundle?.webrtcStats;
  const session = bundle?.session;
  const client = bundle?.client;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Session & E2EE Cryptography */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '10px',
        }}
      >
        <div style={cardStyle}>
          <span style={labelStyle}>Connection</span>
          <span style={{ ...valueStyle, color: isConnected ? 'var(--accent, #00d4aa)' : 'var(--danger, #ff4757)' }}>
            {isConnected ? connectionQuality.toUpperCase() : 'DISCONNECTED'}
          </span>
        </div>

        <div style={cardStyle}>
          <span style={labelStyle}>E2EE Cipher</span>
          <span style={{ ...valueStyle, fontSize: '0.8rem' }}>
            AES-128-GCM
          </span>
        </div>

        <div style={cardStyle}>
          <span style={labelStyle}>Key Exchange</span>
          <span style={{ ...valueStyle, fontSize: '0.8rem' }}>
            DHKEM(P-256)
          </span>
        </div>

        <div style={cardStyle}>
          <span style={labelStyle}>Current Epoch</span>
          <span style={{ ...valueStyle, fontFamily: 'var(--font-mono, monospace)' }}>
            {session?.currentEpoch ?? 0}
          </span>
        </div>
      </div>

      {/* Network WebRTC Stats Table */}
      <div
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--border, #222233)',
          borderRadius: '8px',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg, #eaeaea)' }}>
          Real-Time WebRTC Transport Metrics
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '0.85rem' }}>
          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Transport Type:</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', color: 'var(--accent, #00d4aa)' }}>
              {stats?.transportType ?? 'direct-udp'}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Round Trip (RTT):</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
              {stats ? `${stats.rttMs.toFixed(1)} ms` : '--'}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Packet Loss:</span>
            <span
              style={{
                fontWeight: 600,
                fontFamily: 'var(--font-mono, monospace)',
                color: (stats?.packetLossPct ?? 0) > 3 ? 'var(--danger, #ff4757)' : 'inherit',
              }}
            >
              {stats ? `${stats.packetLossPct.toFixed(2)}%` : '--'}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Jitter:</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
              {stats ? `${stats.jitterMs.toFixed(1)} ms` : '--'}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Outgoing Bitrate:</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
              {stats ? `${stats.availableOutgoingBitrateKbps} kbps` : '--'}
            </span>
          </div>

          <div style={metricRowStyle}>
            <span style={{ color: 'var(--fg-muted, #888899)' }}>Browser Engine:</span>
            <span style={{ fontWeight: 600 }}>{client?.browserEngine ?? 'Web'}</span>
          </div>
        </div>
      </div>

      {/* Privacy Notice & Export Action */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          paddingTop: '6px',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)', maxWidth: '280px' }}>
          🔒 Diagnostics are scrubbed of all PII, raw IP addresses, and media keys.
        </span>

        <button
          onClick={() => downloadDiagnosticBundle()}
          className="btn btn-secondary"
          style={{
            fontSize: '0.8rem',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export Diagnostic Bundle (.json)
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--border, #222233)',
  borderRadius: '8px',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--fg-muted, #888899)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const valueStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 600,
  color: 'var(--fg, #eaeaea)',
};

const metricRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 0',
  borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
};
