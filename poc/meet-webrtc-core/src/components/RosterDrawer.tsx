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
import { ConnectionBadge } from './ConnectionBadge';
import { SpeakingIndicator } from './SpeakingIndicator';

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
  const isLocalHost = hostId === localParticipantId || participantsMap.get(localParticipantId || '')?.isHost;

  const [searchQuery, setSearchQuery] = useState('');

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

  const participantsList = useMemo(() => {
    const list = Array.from(participantsMap.values());
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [participantsMap, searchQuery]);

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
            {participantsMap.size}
          </span>
        </div>
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
          {isLocalHost && onLowerHand && (
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
        {participantsList.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--fg-muted, #888899)', fontSize: '0.875rem' }}>
            No participants found
          </div>
        ) : (
          participantsList.map((p) => {
            const isSelf = p.isLocal;
            const isCurrentHost = p.id === hostId || p.isHost;

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
                          {isLocalHost && onLowerHand && (
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

                  {/* Mic Icon */}
                  <span
                    title={p.audioEnabled ? 'Microphone on' : 'Microphone muted'}
                    aria-label={p.audioEnabled ? 'Microphone on' : 'Microphone muted'}
                    style={{ fontSize: '0.8rem', color: p.audioEnabled ? 'var(--fg, #eaeaea)' : 'var(--danger, #ff4757)' }}
                  >
                    {p.audioEnabled ? '🎤' : '🔇'}
                  </span>

                  {/* Camera Icon */}
                  <span
                    title={p.videoEnabled ? 'Camera on' : 'Camera off'}
                    aria-label={p.videoEnabled ? 'Camera on' : 'Camera off'}
                    style={{ fontSize: '0.8rem', color: p.videoEnabled ? 'var(--fg, #eaeaea)' : 'var(--fg-muted, #888899)' }}
                  >
                    {p.videoEnabled ? '📹' : '🚫'}
                  </span>

                  {/* Connection Quality */}
                  <ConnectionBadge quality={p.connectionQuality} />
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
    </aside>
  );
};
