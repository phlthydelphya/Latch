/**
 * Participant Roster Drawer (M2 Phase A)
 *
 * Slide-out side drawer displaying the real-time meeting roster,
 * active speakers, hand raise queue, connection quality, and device states.
 *
 * Consumes PresenceStore directly; zero LiveKit event coupling.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';
import { ConnectionBadge } from './ConnectionBadge';
import { SpeakingIndicator } from './SpeakingIndicator';
import { HostControlManager } from '../host/hostControlManager';
import { useAppStore } from '../store/appStore';
import { InviteModal } from './InviteModal';
import { usePermissions } from '../hooks/usePermissions';

interface RosterDrawerProps {
  onLowerHand?: (targetParticipantId?: string) => Promise<void> | void;
}

export const RosterDrawer: React.FC<RosterDrawerProps> = ({ onLowerHand }) => {
  const isOpen = usePresenceStore((s) => s.isRosterOpen);
  const setRosterOpen = usePresenceStore((s) => s.setRosterOpen);
  const participantsMap = usePresenceStore((s) => s.participants);
  const raisedHands = usePresenceStore((s) => s.raisedHands);
  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);

  const {
    isHost: isLocalHost,
    isPrivileged,
    canModerateParticipant,
    isParticipantCoHost,
    isParticipantHost,
  } = usePermissions();

  const [searchQuery, setSearchQuery] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [isInviteOpen, setInviteOpen] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setRosterOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setRosterOpen]);

  const waitingIds = useMemo(
    () => new Set(waitingQueue.map((w) => w.participantId)),
    [waitingQueue]
  );

  const activeParticipantsList = useMemo(() => {
    return Array.from(participantsMap.values()).filter((p) => !waitingIds.has(p.id));
  }, [participantsMap, waitingIds]);

  const participantsList = useMemo(() => {
    if (!searchQuery.trim()) return activeParticipantsList;
    const q = searchQuery.toLowerCase();
    return activeParticipantsList.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [activeParticipantsList, searchQuery]);

  if (!isOpen) return null;

  return (
    <aside
      className="roster-drawer"
      role="dialog"
      aria-label="Participant Roster"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: '320px',
        maxWidth: '85vw',
        backgroundColor: 'var(--bg-elevated, #11111a)',
        borderLeft: '1px solid var(--border, #222233)',
        boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.5)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideInRight 200ms ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border, #222233)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Participants</h2>
          <span
            style={{
              fontSize: '0.75rem',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '2px 8px',
              borderRadius: '12px',
              color: 'var(--fg-muted, #888899)',
            }}
          >
            {activeParticipantsList.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setInviteOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '4px 10px',
              backgroundColor: 'rgba(0, 212, 170, 0.15)',
              border: '1px solid rgba(0, 212, 170, 0.4)',
              color: '#00d4aa',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
            title="Invite people to meeting"
          >
            <span>🔗</span>
            <span>Invite</span>
          </button>
          <button
            onClick={() => setRosterOpen(false)}
            aria-label="Close roster"
            style={{
              color: 'var(--fg-muted, #888899)',
              fontSize: '1.25rem',
              padding: '4px 8px',
              borderRadius: '4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Hand Raise Alert Banner */}
      {raisedHands.length > 0 && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'rgba(255, 165, 2, 0.15)',
            borderBottom: '1px solid rgba(255, 165, 2, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '0.8rem',
            color: 'var(--warning, #ffa502)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span aria-hidden="true">✋</span>
            <span>
              {raisedHands.length === 1
                ? `${participantsMap.get(raisedHands[0].participantId)?.name || 'Someone'} raised hand`
                : `${raisedHands.length} hands raised in queue`}
            </span>
          </div>
          {isPrivileged && onLowerHand && (
            <button
              onClick={() => onLowerHand()}
              style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                backgroundColor: 'rgba(255, 165, 2, 0.25)',
                border: '1px solid rgba(255, 165, 2, 0.5)',
                borderRadius: '4px',
                color: 'var(--warning, #ffa502)',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Lower all hands"
            >
              Lower All
            </button>
          )}
        </div>
      )}

      {/* Search Input */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #222233)' }}>
        <input
          type="text"
          placeholder="Filter participants..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Filter participants"
          style={{
            width: '100%',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border, #222233)',
            borderRadius: 'var(--radius-sm, 8px)',
            padding: '8px 12px',
            fontSize: '0.875rem',
            color: 'var(--fg, #eaeaea)',
          }}
        />
      </div>

      {/* Participant List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {isPrivileged && waitingQueue.length > 0 && (
          <div
            style={{
              margin: '8px 16px 16px 16px',
              padding: '12px',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#f59e0b' }}>
                Waiting in Lobby ({waitingQueue.length})
              </span>
              <button
                onClick={async () => {
                  for (const p of [...waitingQueue]) {
                    await HostControlManager.getInstance().admitParticipant(p.participantId);
                  }
                }}
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  backgroundColor: '#00d4aa',
                  color: '#000',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Admit All
              </button>
            </div>
            {waitingQueue.map((wp) => (
              <div
                key={wp.participantId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                  fontSize: '0.85rem',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                  {wp.name}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => HostControlManager.getInstance().admitParticipant(wp.participantId)}
                    style={{
                      fontSize: '0.7rem',
                      padding: '2px 6px',
                      backgroundColor: '#00d4aa',
                      color: '#000',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Admit
                  </button>
                  <button
                    onClick={() => HostControlManager.getInstance().rejectParticipant(wp.participantId)}
                    style={{
                      fontSize: '0.7rem',
                      padding: '2px 6px',
                      backgroundColor: 'rgba(255, 71, 87, 0.2)',
                      color: '#ff4757',
                      border: '1px solid rgba(255, 71, 87, 0.4)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {participantsList.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-muted, #888899)', fontSize: '0.875rem' }}>
            No participants found
          </div>
        ) : (
          participantsList.map((p) => {
            const isSelf = p.isLocal;
            const isCurrentHost = hostId !== null && hostId === p.id;

            return (
              <div
                key={p.id}
                style={{
                  padding: '10px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                  backgroundColor: p.isSpeaking ? 'rgba(0, 212, 170, 0.05)' : undefined,
                  transition: 'background-color 150ms ease',
                }}
              >
                {/* Left: Avatar & Identity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: isSelf ? 'var(--accent, #00d4aa)' : '#3b82f6',
                      color: '#000',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.85rem',
                      flexShrink: 0,
                    }}
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '130px',
                        }}
                      >
                        {p.name}
                      </span>
                      {isSelf && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--fg-muted, #888899)' }}>
                          (You)
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      {isCurrentHost && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            backgroundColor: 'rgba(245, 158, 11, 0.2)',
                            color: '#f59e0b',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 600,
                          }}
                        >
                          Host
                        </span>
                      )}
                      {isParticipantCoHost(p.id) && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            backgroundColor: 'rgba(59, 130, 246, 0.2)',
                            color: '#60a5fa',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            fontWeight: 600,
                          }}
                        >
                          Co-Host
                        </span>
                      )}
                      {p.isHandRaised && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span
                            style={{
                              fontSize: '0.65rem',
                              backgroundColor: 'rgba(255, 165, 2, 0.2)',
                              color: 'var(--warning, #ffa502)',
                              padding: '1px 5px',
                              borderRadius: '4px',
                            }}
                          >
                            ✋ Raised
                          </span>
                          {isPrivileged && onLowerHand && (
                            <button
                              onClick={() => onLowerHand(p.id)}
                              style={{
                                fontSize: '0.65rem',
                                backgroundColor: 'rgba(255, 165, 2, 0.25)',
                                border: '1px solid rgba(255, 165, 2, 0.4)',
                                borderRadius: '4px',
                                color: 'var(--warning, #ffa502)',
                                padding: '1px 5px',
                                cursor: 'pointer',
                              }}
                              title={`Lower ${p.name}'s hand`}
                            >
                              Lower
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Media & Connection Status Icons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <SpeakingIndicator isSpeaking={p.isSpeaking} size="sm" />

                  {/* Mic Icon — three-state: on | muted | unavailable */}
                  <span
                    title={
                      p.microphoneState === 'on' ? 'Microphone on'
                      : p.microphoneState === 'muted' ? 'Microphone muted'
                      : 'Microphone unavailable'
                    }
                    aria-label={
                      p.microphoneState === 'on' ? 'Microphone on'
                      : p.microphoneState === 'muted' ? 'Microphone muted'
                      : 'Microphone unavailable'
                    }
                    style={{
                      fontSize: '0.8rem',
                      color: p.microphoneState === 'on'
                        ? 'var(--fg, #eaeaea)'
                        : p.microphoneState === 'muted'
                          ? 'var(--danger, #ff4757)'
                          : 'var(--fg-muted, #888899)',
                    }}
                  >
                    {p.microphoneState === 'on' ? '🎤' : p.microphoneState === 'muted' ? '🔇' : '🎙️'}
                  </span>

                  {/* Camera Icon — three-state: on | muted | unavailable */}
                  <span
                    title={
                      p.cameraState === 'on' ? 'Camera on'
                      : p.cameraState === 'muted' ? 'Camera off'
                      : 'Camera unavailable'
                    }
                    aria-label={
                      p.cameraState === 'on' ? 'Camera on'
                      : p.cameraState === 'muted' ? 'Camera off'
                      : 'Camera unavailable'
                    }
                    style={{
                      fontSize: '0.8rem',
                      color: p.cameraState === 'on'
                        ? 'var(--fg, #eaeaea)'
                        : 'var(--fg-muted, #888899)',
                    }}
                  >
                    {p.cameraState === 'on' ? '📹' : p.cameraState === 'muted' ? '🚫' : '📷'}
                  </span>

                  {/* Connection Quality */}
                  <ConnectionBadge quality={p.connectionQuality} />

                  {/* Moderation Menu */}
                  {canModerateParticipant(p.id) && (
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setActionMenuId(actionMenuId === p.id ? null : p.id)}
                        aria-label={`Moderation options for ${p.name}`}
                        aria-expanded={actionMenuId === p.id}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--fg-muted, #888899)',
                          cursor: 'pointer',
                          padding: '2px 4px',
                          borderRadius: '4px',
                          fontSize: '1rem',
                          lineHeight: 1,
                        }}
                      >
                        ⋮
                      </button>
                      {actionMenuId === p.id && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            backgroundColor: 'var(--bg-elevated, #1a1a28)',
                            border: '1px solid var(--border, #33334d)',
                            borderRadius: '8px',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
                            zIndex: 1100,
                            minWidth: '140px',
                            padding: '4px 0',
                          }}
                        >
                          {p.audioEnabled && (
                            <button
                              onClick={() => {
                                HostControlManager.getInstance().muteParticipant(p.id);
                                setActionMenuId(null);
                              }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '6px 12px',
                                background: 'none',
                                border: 'none',
                                color: 'var(--fg, #eaeaea)',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <span>🔇</span> Mute
                            </button>
                          )}
                          {p.screenSharing && (
                            <button
                              onClick={() => {
                                HostControlManager.getInstance().stopParticipantShare(p.id);
                                setActionMenuId(null);
                              }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '6px 12px',
                                background: 'none',
                                border: 'none',
                                color: 'var(--fg, #eaeaea)',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <span>🛑</span> Stop Share
                            </button>
                          )}
                          {isLocalHost && !isParticipantHost(p.id) && (
                            isParticipantCoHost(p.id) ? (
                              <button
                                onClick={() => {
                                  HostControlManager.getInstance().revokeCoHost(p.id);
                                  setActionMenuId(null);
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '6px 12px',
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--fg, #eaeaea)',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <span>🛡️</span> Remove Co-Host
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  HostControlManager.getInstance().assignCoHost(p.id);
                                  setActionMenuId(null);
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '6px 12px',
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--fg, #eaeaea)',
                                  fontSize: '0.8rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                <span>🛡️</span> Make Co-Host
                              </button>
                            )
                          )}
                          {isLocalHost && !isCurrentHost && (
                            <button
                              onClick={() => {
                                HostControlManager.getInstance().transferHost(p.id);
                                setActionMenuId(null);
                              }}
                              style={{
                                width: '100%',
                                textAlign: 'left',
                                padding: '6px 12px',
                                background: 'none',
                                border: 'none',
                                color: 'var(--fg, #eaeaea)',
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <span>👑</span> Make Host
                            </button>
                          )}
                          <button
                            onClick={() => {
                              HostControlManager.getInstance().removeParticipant(p.id);
                              setActionMenuId(null);
                            }}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '6px 12px',
                              background: 'none',
                              border: 'none',
                              color: '#ff4757',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>🚪</span> Remove
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
      <InviteModal
        isOpen={isInviteOpen}
        onClose={() => setInviteOpen(false)}
        roomId={useAppStore.getState().roomId || ''}
        keyParam={useAppStore.getState().keyParam || undefined}
      />
    </aside>
  );
};
