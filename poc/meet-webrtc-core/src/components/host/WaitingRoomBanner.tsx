/**
 * Waiting Room Notification Banner (M2 Phase E)
 *
 * Floating banner displayed to the host when participants are
 * waiting in the lobby/waiting room gate.
 */

import React from 'react';
import { useHostControlStore } from '../../host/hostControlStore';
import { HostControlManager } from '../../host/hostControlManager';
import { usePresenceStore } from '../../presence/presenceStore';

export const WaitingRoomBanner: React.FC = () => {
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);
  const setHostModalOpen = useHostControlStore((s) => s.setHostModalOpen);

  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const isLocalHost = hostId !== null && hostId === localParticipantId;

  if (!isLocalHost || waitingQueue.length === 0) return null;

  const handleAdmitFirst = async () => {
    if (waitingQueue.length > 0) {
      await HostControlManager.getInstance().admitParticipant(waitingQueue[0].participantId);
    }
  };

  const handleAdmitAll = async () => {
    const queue = [...waitingQueue];
    for (const p of queue) {
      await HostControlManager.getInstance().admitParticipant(p.participantId);
    }
  };

  const bannerText =
    waitingQueue.length === 1
      ? `${waitingQueue[0].name} is waiting to join`
      : `${waitingQueue.length} guests are waiting in the lobby`;

  return (
    <aside
      aria-label="Waiting Room Notifications"
      style={{
        position: 'absolute',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: 'rgba(20, 20, 30, 0.95)',
        border: '1px solid rgba(0, 212, 170, 0.4)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
        borderRadius: '24px',
        padding: '6px 16px',
        backdropFilter: 'blur(8px)',
        animation: 'slideDown 200ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '1rem' }}>🚪</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--fg, #eaeaea)' }}>
          {bannerText}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {waitingQueue.length === 1 ? (
          <button
            onClick={handleAdmitFirst}
            style={{
              padding: '4px 10px',
              backgroundColor: 'var(--accent, #00d4aa)',
              border: 'none',
              borderRadius: '12px',
              color: '#000',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Admit
          </button>
        ) : (
          <button
            onClick={handleAdmitAll}
            style={{
              padding: '4px 10px',
              backgroundColor: 'var(--accent, #00d4aa)',
              border: 'none',
              borderRadius: '12px',
              color: '#000',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Admit All
          </button>
        )}

        <button
          onClick={() => setHostModalOpen(true, 'security')}
          style={{
            padding: '4px 10px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '12px',
            color: 'var(--fg, #eaeaea)',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Review
        </button>
      </div>

      <style>{`
        @keyframes slideDown {
          from { transform: translate(-50%, -20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }
      `}</style>
    </aside>
  );
};
