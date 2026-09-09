import { useLayoutStore } from '../../layout/layoutStore';
import { usePresenceStore } from '../../presence/presenceStore';
import { LayoutMode } from '../../layout/types';

interface LayoutControlsProps {
  onClearSpotlight?: () => void;
}

export function LayoutControls({ onClearSpotlight }: LayoutControlsProps) {
  const mode = useLayoutStore((s) => s.mode);
  const setLayoutMode = useLayoutStore((s) => s.setLayoutMode);
  const pinnedParticipantId = useLayoutStore((s) => s.pinnedParticipantId);
  const pinParticipant = useLayoutStore((s) => s.pinParticipant);
  const spotlightParticipantId = useLayoutStore((s) => s.spotlightParticipantId);
  const screenShareOwnerId = useLayoutStore((s) => s.screenShareOwnerId);

  const presence = usePresenceStore();
  const localId = presence.localParticipantId;
  const isHost = presence.hostId !== null && presence.hostId === localId;

  const pinnedName = pinnedParticipantId
    ? presence.participants.get(pinnedParticipantId)?.name || 'Participant'
    : null;

  const spotlightName = spotlightParticipantId
    ? presence.participants.get(spotlightParticipantId)?.name || 'Participant'
    : null;

  return (
    <div
      role="toolbar"
      aria-label="Layout view selection"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '8px',
        padding: '3px',
      }}
    >
      <button
        onClick={() => setLayoutMode('gallery')}
        aria-pressed={mode === 'gallery'}
        aria-label="Gallery view"
        style={{
          background: mode === 'gallery' ? 'var(--bg-elevated, #1f1f2e)' : 'transparent',
          color: mode === 'gallery' ? 'var(--accent, #00d4aa)' : 'var(--fg-muted)',
          border: mode === 'gallery' ? '1px solid var(--border)' : '1px solid transparent',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.8rem',
          fontWeight: mode === 'gallery' ? 600 : 400,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          transition: 'all 120ms ease',
        }}
      >
        <span>▦</span>
        <span>Gallery</span>
      </button>

      <button
        onClick={() => setLayoutMode('speaker')}
        aria-pressed={mode === 'speaker'}
        aria-label="Speaker view"
        style={{
          background: mode === 'speaker' ? 'var(--bg-elevated, #1f1f2e)' : 'transparent',
          color: mode === 'speaker' ? 'var(--accent, #00d4aa)' : 'var(--fg-muted)',
          border: mode === 'speaker' ? '1px solid var(--border)' : '1px solid transparent',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '0.8rem',
          fontWeight: mode === 'speaker' ? 600 : 400,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          transition: 'all 120ms ease',
        }}
      >
        <span>👤</span>
        <span>Speaker</span>
      </button>

      {screenShareOwnerId && (
        <button
          onClick={() => setLayoutMode('content')}
          aria-pressed={mode === 'content'}
          aria-label="Screen presentation view"
          style={{
            background: mode === 'content' ? 'var(--bg-elevated, #1f1f2e)' : 'transparent',
            color: mode === 'content' ? 'var(--accent, #00d4aa)' : 'var(--fg-muted)',
            border: mode === 'content' ? '1px solid var(--border)' : '1px solid transparent',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '0.8rem',
            fontWeight: mode === 'content' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            transition: 'all 120ms ease',
          }}
        >
          <span>🖥</span>
          <span>Presentation</span>
        </button>
      )}

      {/* Pin indicator badge */}
      {pinnedName && (
        <button
          onClick={() => pinParticipant(null)}
          title="Click to unpin"
          aria-label={`Unpin ${pinnedName}`}
          style={{
            background: 'rgba(59, 130, 246, 0.2)',
            color: '#60a5fa',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>📌 {pinnedName}</span>
          <span style={{ fontSize: '0.65rem' }}>✕</span>
        </button>
      )}

      {/* Spotlight indicator badge */}
      {spotlightName && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(234, 179, 8, 0.2)',
            color: '#facc15',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
          }}
        >
          <span>⭐ {spotlightName}</span>
          {isHost && onClearSpotlight && (
            <button
              onClick={onClearSpotlight}
              title="Clear spotlight for all"
              aria-label="Clear spotlight"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#facc15',
                cursor: 'pointer',
                fontSize: '0.65rem',
                padding: '0 2px',
              }}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
