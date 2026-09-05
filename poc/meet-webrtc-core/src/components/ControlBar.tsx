import { useAppStore } from '../store/appStore';
import { ShieldBadge } from './ShieldBadge';
import { ConnectionIndicator } from './ConnectionIndicator';
import { downloadDiagnosticBundle } from '../utils/diagnostics';
import { HandRaiseButton } from './HandRaiseButton';
import { usePresenceStore } from '../presence/presenceStore';
import { useCollaborationStore } from '../collaboration/collaborationStore';

interface ControlBarProps {
  onToggleHand?: (raised: boolean) => Promise<void> | void;
}

export function ControlBar({ onToggleHand }: ControlBarProps = {}) {
  const {
    localParticipant,
    toggleLocalAudio,
    toggleLocalVideo,
    setLocalScreenShare,
    leave,
    isConnected,
    isReconnecting,
  } = useAppStore();

  const isRosterOpen = usePresenceStore((s) => s.isRosterOpen);
  const toggleRoster = usePresenceStore((s) => s.toggleRoster);
  const participantCount = usePresenceStore((s) => s.participants.size);

  const isChatOpen = useCollaborationStore((s) => s.isChatOpen);
  const toggleChat = useCollaborationStore((s) => s.toggleChat);
  const unreadCount = useCollaborationStore((s) => s.unreadCount);
  const isReactionsBarOpen = useCollaborationStore((s) => s.isReactionsBarOpen);
  const toggleReactionsBar = useCollaborationStore((s) => s.toggleReactionsBar);

  const audioEnabled = localParticipant?.audioEnabled ?? true;
  const videoEnabled = localParticipant?.videoEnabled ?? true;
  const screenSharing = localParticipant?.screenSharing ?? false;

  const handleScreenShare = async () => {
    if (screenSharing) {
      await setLocalScreenShare(false);
    } else {
      await setLocalScreenShare(true);
    }
  };

  return (
    <footer className="control-bar" role="region" aria-label="Meeting controls">
      <div className="control-bar__group" style={{ marginRight: 'auto' }}>
        <ShieldBadge />
        <ConnectionIndicator />
      </div>

      <div className="control-bar__group">
        <button
          className={`media-toggle ${audioEnabled ? 'active' : 'muted'}`}
          onClick={toggleLocalAudio}
          aria-pressed={audioEnabled}
          aria-label={audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
          disabled={!isConnected || isReconnecting}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {audioEnabled ? (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </>
            ) : (
              <>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95a7 7 0 0 1-14 0" />
              </>
            )}
          </svg>
        </button>

        <button
          className={`media-toggle ${videoEnabled ? 'active' : 'muted'}`}
          onClick={toggleLocalVideo}
          aria-pressed={videoEnabled}
          aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
          disabled={!isConnected || isReconnecting}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {videoEnabled ? (
              <>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="12" r="4" />
              </>
            ) : (
              <>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </>
            )}
          </svg>
        </button>

        <button
          className={`media-toggle ${screenSharing ? 'active' : ''}`}
          onClick={handleScreenShare}
          aria-pressed={screenSharing}
          aria-label={screenSharing ? 'Stop screen sharing' : 'Start screen sharing'}
          disabled={!isConnected || isReconnecting}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>

        <HandRaiseButton onToggleHand={onToggleHand} disabled={!isConnected || isReconnecting} />

        <button
          className={`media-toggle ${isReactionsBarOpen ? 'active' : ''}`}
          onClick={() => toggleReactionsBar()}
          aria-pressed={isReactionsBarOpen}
          aria-label="Reactions"
          title="Send Reaction"
          disabled={!isConnected || isReconnecting}
          style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span>😊</span>
        </button>
      </div>

      <div className="control-bar__group" style={{ marginLeft: 'auto' }}>
        <button
          className={`btn ${isChatOpen ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => toggleChat()}
          aria-pressed={isChatOpen}
          aria-label="Toggle In-Call Chat"
          title="Toggle In-Call Chat"
          style={{
            marginRight: '8px',
            fontSize: '0.85rem',
            padding: '6px 10px',
            backgroundColor: isChatOpen ? 'var(--accent, #00d4aa)' : undefined,
            color: isChatOpen ? '#000' : undefined,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>💬</span>
          <span>Chat</span>
          {unreadCount > 0 && !isChatOpen && (
            <span
              style={{
                marginLeft: '4px',
                background: '#ff4757',
                color: '#fff',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '0.7rem',
                fontWeight: 700,
              }}
            >
              {unreadCount}
            </span>
          )}
        </button>

        <button
          className={`btn ${isRosterOpen ? 'btn-primary' : 'btn-secondary'}`}
          onClick={toggleRoster}
          aria-label="Toggle Participants Roster"
          title="Toggle Participants Roster"
          style={{ marginRight: '8px', fontSize: '0.85rem', padding: '6px 10px', backgroundColor: isRosterOpen ? 'var(--accent, #00d4aa)' : undefined, color: isRosterOpen ? '#000' : undefined }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: '4px', verticalAlign: 'text-bottom' }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Participants ({participantCount})
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => downloadDiagnosticBundle()}
          aria-label="Download Sanitized Diagnostics"
          title="Export Privacy-Preserving Diagnostic Bundle"
          style={{ marginRight: '8px', fontSize: '0.85rem', padding: '6px 10px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ marginRight: '4px', verticalAlign: 'text-bottom' }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Diagnostics
        </button>
        <button
          className="btn btn-danger"
          onClick={leave}
          aria-label="Leave meeting"
          disabled={!isConnected || isReconnecting}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Leave
        </button>
      </div>
    </footer>
  );
}