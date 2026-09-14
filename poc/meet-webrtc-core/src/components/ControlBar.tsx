import { useState, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { ShieldBadge } from './ShieldBadge';
import { ConnectionIndicator } from './ConnectionIndicator';
import { downloadDiagnosticBundle } from '../utils/diagnostics';
import { HandRaiseButton } from './HandRaiseButton';
import { usePresenceStore } from '../presence/presenceStore';
import { useCollaborationStore } from '../collaboration/collaborationStore';
import { useDeviceStore } from '../devices/deviceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { HostControlManager } from '../host/hostControlManager';
import { LeaveConfirmationModal } from './LeaveConfirmationModal';
import { InviteModal } from './InviteModal';
import { usePermissions } from '../hooks/usePermissions';

interface ControlBarProps {
  onToggleAudio?: () => Promise<void> | void;
  onToggleVideo?: () => Promise<void> | void;
  onToggleHand?: (raised: boolean) => Promise<void> | void;
  onToggleScreenShare?: (sharing: boolean) => Promise<void> | void;
  onLeave?: () => Promise<void> | void;
}

export function ControlBar({ onToggleAudio, onToggleVideo, onToggleHand, onToggleScreenShare, onLeave }: ControlBarProps = {}) {
  const {
    localParticipant,
    leave,
    isConnected,
    isReconnecting,
  } = useAppStore();

  const isRosterOpen = usePresenceStore((s) => s.isRosterOpen);
  const toggleRoster = usePresenceStore((s) => s.toggleRoster);
  const participantsMap = usePresenceStore((s) => s.participants);
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);

  const participantCount = useMemo(() => {
    const waitingIds = new Set(waitingQueue.map((w) => w.participantId));
    let count = 0;
    for (const p of participantsMap.values()) {
      if (!waitingIds.has(p.id)) count++;
    }
    return count;
  }, [participantsMap, waitingQueue]);

  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const publishedLocalParticipant = usePresenceStore((s) =>
    s.localParticipantId ? s.participants.get(s.localParticipantId) : undefined
  );

  const { isHost: isLocalHost, isPrivileged, canShareScreen: canUserShareScreen } = usePermissions();

  const permissions = useHostControlStore((s) => s.permissions);
  const setHostModalOpen = useHostControlStore((s) => s.setHostModalOpen);

  const isChatOpen = useCollaborationStore((s) => s.isChatOpen);
  const toggleChat = useCollaborationStore((s) => s.toggleChat);
  const unreadCount = useCollaborationStore((s) => s.unreadCount);
  const isReactionsBarOpen = useCollaborationStore((s) => s.isReactionsBarOpen);
  const toggleReactionsBar = useCollaborationStore((s) => s.toggleReactionsBar);

  const audioEnabled = publishedLocalParticipant?.audioEnabled ?? localParticipant?.audioEnabled ?? false;
  const videoEnabled = publishedLocalParticipant?.videoEnabled ?? localParticipant?.videoEnabled ?? false;
  const screenSharing = localParticipant?.screenSharing ?? false;

  const isMuteLocked = !audioEnabled && !permissions.canUnmuteSelf && !isLocalHost;
  const isScreenShareLocked = !canUserShareScreen;
  const isReactionsLocked = !permissions.canReact && !isLocalHost;
  const isChatLocked = !permissions.canChat && !isLocalHost;

  const [isLeaveModalOpen, setLeaveModalOpen] = useState(false);
  const [isInviteModalOpen, setInviteModalOpen] = useState(false);

  const handleLeaveClick = () => {
    // If host is the final participant, leave directly without modal
    if (isLocalHost && participantCount <= 1) {
      if (onLeave) {
        onLeave();
      } else {
        leave();
      }
      return;
    }
    setLeaveModalOpen(true);
  };

  const handleConfirmLeave = async () => {
    setLeaveModalOpen(false);
    if (onLeave) {
      await onLeave();
    } else {
      leave();
    }
  };

  const handleTransferAndLeave = async (targetId: string) => {
    try {
      await HostControlManager.getInstance().transferHost(targetId);
    } catch (err) {
      console.error('Host transfer before leave failed:', err);
      throw err;
    }
    setLeaveModalOpen(false);
    if (onLeave) {
      await onLeave();
    } else {
      leave();
    }
  };

  const handleScreenShare = async () => {
    if (!onToggleScreenShare) return;
    await onToggleScreenShare(!screenSharing);
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
          onClick={() => void onToggleAudio?.()}
          aria-pressed={audioEnabled}
          aria-label={isMuteLocked ? 'Unmuting restricted by host' : (audioEnabled ? 'Mute microphone' : 'Unmute microphone')}
          title={isMuteLocked ? 'Unmuting restricted by host' : (audioEnabled ? 'Mute microphone' : 'Unmute microphone')}
          disabled={!isConnected || isReconnecting || isMuteLocked || !onToggleAudio}
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
          onClick={() => void onToggleVideo?.()}
          aria-pressed={videoEnabled}
          aria-label={videoEnabled ? 'Turn off camera' : 'Turn on camera'}
          disabled={!isConnected || isReconnecting || !onToggleVideo}
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
          aria-label={isScreenShareLocked ? 'Screen sharing restricted by host' : (screenSharing ? 'Stop screen sharing' : 'Start screen sharing')}
          title={isScreenShareLocked ? 'Screen sharing restricted by host' : (screenSharing ? 'Stop screen sharing' : 'Start screen sharing')}
          disabled={!isConnected || isReconnecting || isScreenShareLocked}
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
          aria-label={isReactionsLocked ? 'Reactions restricted by host' : 'Reactions'}
          title={isReactionsLocked ? 'Reactions restricted by host' : 'Send Reaction'}
          disabled={!isConnected || isReconnecting || isReactionsLocked}
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
          aria-label={isChatLocked ? 'Chat restricted by host' : 'Toggle In-Call Chat'}
          title={isChatLocked ? 'Chat restricted by host' : 'Toggle In-Call Chat'}
          disabled={isChatLocked}
          style={{
            marginRight: '8px',
            fontSize: '0.85rem',
            padding: '6px 10px',
            backgroundColor: isChatOpen ? 'var(--accent, #00d4aa)' : undefined,
            color: isChatOpen ? '#000' : undefined,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            opacity: isChatLocked ? 0.5 : 1,
            cursor: isChatLocked ? 'not-allowed' : 'pointer',
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
          onClick={() => setInviteModalOpen(true)}
          aria-label="Invite Participants"
          title="Share meeting link and QR code"
          style={{ marginRight: '8px', fontSize: '0.85rem', padding: '6px 10px' }}
        >
          <span style={{ marginRight: '4px' }}>🔗</span>
          Invite
        </button>

        {isPrivileged && (
          <button
            className="btn btn-secondary"
            onClick={() => setHostModalOpen(true)}
            aria-label="Host Controls & Moderation"
            title="Room lock, waiting room, and attendee permissions"
            style={{ marginRight: '8px', fontSize: '0.85rem', padding: '6px 10px' }}
          >
            <span style={{ marginRight: '4px' }}>🛡️</span>
            Host Tools
          </button>
        )}

        <button
          className="btn btn-secondary"
          onClick={() => useDeviceStore.getState().setSettingsOpen(true, 'audio')}
          aria-label="Device and Hardware Settings"
          title="Microphone, Speaker, and Camera Settings"
          style={{ marginRight: '8px', fontSize: '0.85rem', padding: '6px 10px' }}
        >
          <span style={{ marginRight: '4px' }}>⚙️</span>
          Settings
        </button>

        <button
          className="btn btn-secondary"
          onClick={() => useDeviceStore.getState().setSettingsOpen(true, 'diagnostics')}
          aria-label="Real-Time Network Diagnostics"
          title="Real-Time WebRTC Diagnostics & Health"
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
          onClick={handleLeaveClick}
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

      <LeaveConfirmationModal
        isOpen={isLeaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        onConfirmLeave={handleConfirmLeave}
        onTransferAndLeave={handleTransferAndLeave}
        isHost={isLocalHost}
      />

      <InviteModal
        isOpen={isInviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        roomId={useAppStore.getState().roomId || ''}
        keyParam={useAppStore.getState().keyParam || undefined}
      />
    </footer>
  );
}
