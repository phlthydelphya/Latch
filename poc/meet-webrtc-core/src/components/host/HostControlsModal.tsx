/**
 * Host Controls & Moderation Modal (M2 Phase E)
 *
 * Ephemeral modal allowing the meeting host to manage room lock,
 * waiting room gates, admit/reject knocking guests, and set granular
 * attendee permissions (mute, screen share, chat, reactions).
 */

import React, { useEffect } from 'react';
import { useHostControlStore } from '../../host/hostControlStore';
import { HostControlManager } from '../../host/hostControlManager';
import { usePresenceStore } from '../../presence/presenceStore';

export const HostControlsModal: React.FC = () => {
  const isHostModalOpen = useHostControlStore((s) => s.isHostModalOpen);
  const setHostModalOpen = useHostControlStore((s) => s.setHostModalOpen);
  const activeTab = useHostControlStore((s) => s.activeTab);
  const setActiveTab = useHostControlStore((s) => s.setActiveTab);

  const isRoomLocked = useHostControlStore((s) => s.isRoomLocked);
  const isWaitingRoomEnabled = useHostControlStore((s) => s.isWaitingRoomEnabled);
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);
  const permissions = useHostControlStore((s) => s.permissions);

  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const participants = usePresenceStore((s) => s.participants);
  const isLocalHost = hostId === localParticipantId || participants.get(localParticipantId || '')?.isHost;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isHostModalOpen) {
        setHostModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHostModalOpen, setHostModalOpen]);

  if (!isHostModalOpen) return null;

  const handleToggleRoomLock = async () => {
    await HostControlManager.getInstance().setRoomLocked(!isRoomLocked);
  };

  const handleToggleWaitingRoom = async () => {
    await HostControlManager.getInstance().setWaitingRoomEnabled(!isWaitingRoomEnabled);
  };

  const handleAdmit = async (participantId: string) => {
    await HostControlManager.getInstance().admitParticipant(participantId);
  };

  const handleReject = async (participantId: string) => {
    await HostControlManager.getInstance().rejectParticipant(participantId);
  };

  const handleAdmitAll = async () => {
    const queue = [...waitingQueue];
    for (const p of queue) {
      await HostControlManager.getInstance().admitParticipant(p.participantId);
    }
  };

  const handleTogglePermission = async (key: keyof typeof permissions) => {
    await HostControlManager.getInstance().updatePermissions({
      [key]: !permissions[key],
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="host-controls-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 150ms ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setHostModalOpen(false);
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--bg-elevated, #14141e)',
          border: '1px solid var(--border, #28283c)',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border, #28283c)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.25rem' }}>🛡️</span>
            <div>
              <h2
                id="host-controls-modal-title"
                style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: 'var(--fg, #eaeaea)' }}
              >
                Host Controls & Moderation
              </h2>
              <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)' }}>
                {isLocalHost ? 'Host Privileges Active' : 'Meeting Moderation Policy'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setHostModalOpen(false)}
            aria-label="Close host controls"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-muted, #888899)',
              fontSize: '1.25rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          aria-label="Host Control Categories"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border, #28283c)',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            padding: '0 16px',
          }}
        >
          <button
            role="tab"
            aria-selected={activeTab === 'security'}
            onClick={() => setActiveTab('security')}
            style={{
              padding: '12px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'security' ? '2px solid var(--accent, #00d4aa)' : '2px solid transparent',
              color: activeTab === 'security' ? 'var(--accent, #00d4aa)' : 'var(--fg-muted, #888899)',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>🔒</span>
            <span>Room Security</span>
            {waitingQueue.length > 0 && (
              <span
                style={{
                  backgroundColor: '#ff4757',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '1px 6px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                }}
              >
                {waitingQueue.length}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'permissions'}
            onClick={() => setActiveTab('permissions')}
            style={{
              padding: '12px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'permissions' ? '2px solid var(--accent, #00d4aa)' : '2px solid transparent',
              color: activeTab === 'permissions' ? 'var(--accent, #00d4aa)' : 'var(--fg-muted, #888899)',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>👥</span>
            <span>Attendee Permissions</span>
          </button>
        </div>

        {/* Tab Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'security' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Meeting Lock Section */}
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  border: isRoomLocked ? '1px solid rgba(255, 71, 87, 0.4)' : '1px solid var(--border, #28283c)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>{isRoomLocked ? '🔒' : '🔓'}</span>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--fg, #eaeaea)' }}>
                        Lock Meeting
                      </span>
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          backgroundColor: isRoomLocked ? 'rgba(255, 71, 87, 0.2)' : 'rgba(0, 212, 170, 0.2)',
                          color: isRoomLocked ? '#ff4757' : '#00d4aa',
                        }}
                      >
                        {isRoomLocked ? 'LOCKED' : 'OPEN'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleRoomLock}
                    disabled={!isLocalHost}
                    aria-label={isRoomLocked ? 'Unlock meeting' : 'Lock meeting'}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: isRoomLocked ? '#ff4757' : 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: isLocalHost ? 'pointer' : 'not-allowed',
                      opacity: isLocalHost ? 1 : 0.6,
                    }}
                  >
                    {isRoomLocked ? 'Unlock Room' : 'Lock Room'}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fg-muted, #888899)' }}>
                  When locked, no new participants can enter the room even with the meeting link.
                </p>
              </div>

              {/* Waiting Room Section */}
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>🚪</span>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--fg, #eaeaea)' }}>
                        Waiting Room Gate
                      </span>
                      <span
                        style={{
                          marginLeft: '8px',
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          backgroundColor: isWaitingRoomEnabled ? 'rgba(0, 212, 170, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                          color: isWaitingRoomEnabled ? '#00d4aa' : 'var(--fg-muted, #888899)',
                        }}
                      >
                        {isWaitingRoomEnabled ? 'ENABLED' : 'DISABLED'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleToggleWaitingRoom}
                    disabled={!isLocalHost}
                    aria-label={isWaitingRoomEnabled ? 'Disable waiting room' : 'Enable waiting room'}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: isWaitingRoomEnabled ? 'var(--accent, #00d4aa)' : 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      borderRadius: '6px',
                      color: isWaitingRoomEnabled ? '#000' : '#fff',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: isLocalHost ? 'pointer' : 'not-allowed',
                      opacity: isLocalHost ? 1 : 0.6,
                    }}
                  >
                    {isWaitingRoomEnabled ? 'Disable Gate' : 'Enable Gate'}
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fg-muted, #888899)' }}>
                  When enabled, incoming participants must knock and wait for host admission.
                </p>
              </div>

              {/* Waiting Room Queue */}
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '12px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--fg, #eaeaea)' }}>
                      Waiting Guests
                    </span>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        padding: '1px 6px',
                        borderRadius: '10px',
                        color: 'var(--fg-muted, #888899)',
                      }}
                    >
                      {waitingQueue.length}
                    </span>
                  </div>
                  {isLocalHost && waitingQueue.length > 1 && (
                    <button
                      onClick={handleAdmitAll}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: 'rgba(0, 212, 170, 0.2)',
                        border: '1px solid var(--accent, #00d4aa)',
                        borderRadius: '4px',
                        color: 'var(--accent, #00d4aa)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Admit All ({waitingQueue.length})
                    </button>
                  )}
                </div>

                {waitingQueue.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '16px', color: 'var(--fg-muted, #888899)', fontSize: '0.825rem' }}>
                    No participants currently waiting in lobby.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {waitingQueue.map((p) => (
                      <div
                        key={p.participantId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--fg, #eaeaea)' }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted, #888899)' }}>
                            Knocked {new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>

                        {isLocalHost && (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => handleAdmit(p.participantId)}
                              style={{
                                padding: '4px 10px',
                                backgroundColor: 'var(--accent, #00d4aa)',
                                border: 'none',
                                borderRadius: '4px',
                                color: '#000',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Admit
                            </button>
                            <button
                              onClick={() => handleReject(p.participantId)}
                              style={{
                                padding: '4px 10px',
                                backgroundColor: 'rgba(255, 71, 87, 0.15)',
                                border: '1px solid rgba(255, 71, 87, 0.3)',
                                borderRadius: '4px',
                                color: '#ff4757',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Decline
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Attendee Permissions Section */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: 'var(--fg-muted, #888899)' }}>
                Configure what attendees are permitted to do during this meeting.
                {!isLocalHost && ' (Viewing host policy)'}
              </p>

              {/* Permission: canUnmuteSelf */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)' }}>
                    Allow attendees to unmute microphone
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)', marginTop: '2px' }}>
                    When disabled, attendees cannot unmute themselves after being muted.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={permissions.canUnmuteSelf}
                  disabled={!isLocalHost}
                  onChange={() => handleTogglePermission('canUnmuteSelf')}
                  aria-label="Allow attendees to unmute microphone"
                  style={{ width: '18px', height: '18px', cursor: isLocalHost ? 'pointer' : 'not-allowed' }}
                />
              </div>

              {/* Permission: canShareScreen */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)' }}>
                    Allow screen sharing
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)', marginTop: '2px' }}>
                    When disabled, only the host can share desktop/app screens.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={permissions.canShareScreen}
                  disabled={!isLocalHost}
                  onChange={() => handleTogglePermission('canShareScreen')}
                  aria-label="Allow screen sharing"
                  style={{ width: '18px', height: '18px', cursor: isLocalHost ? 'pointer' : 'not-allowed' }}
                />
              </div>

              {/* Permission: canChat */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)' }}>
                    Allow in-call chat
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)', marginTop: '2px' }}>
                    When disabled, attendees cannot send chat messages.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={permissions.canChat}
                  disabled={!isLocalHost}
                  onChange={() => handleTogglePermission('canChat')}
                  aria-label="Allow in-call chat"
                  style={{ width: '18px', height: '18px', cursor: isLocalHost ? 'pointer' : 'not-allowed' }}
                />
              </div>

              {/* Permission: canReact */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #28283c)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)' }}>
                    Allow emoji reactions
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted, #888899)', marginTop: '2px' }}>
                    When disabled, emoji reactions cannot be floated across the screen.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={permissions.canReact}
                  disabled={!isLocalHost}
                  onChange={() => handleTogglePermission('canReact')}
                  aria-label="Allow emoji reactions"
                  style={{ width: '18px', height: '18px', cursor: isLocalHost ? 'pointer' : 'not-allowed' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border, #28283c)',
            display: 'flex',
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button
            onClick={() => setHostModalOpen(false)}
            style={{
              padding: '8px 18px',
              backgroundColor: 'var(--accent, #00d4aa)',
              border: 'none',
              borderRadius: '8px',
              color: '#000',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
