/**
 * Room Lock Status Badge (M2 Phase E)
 *
 * Visual indicator shown in the header/status area when the meeting is locked.
 */

import React from 'react';
import { useHostControlStore } from '../../host/hostControlStore';
import { usePresenceStore } from '../../presence/presenceStore';

export const RoomLockBadge: React.FC = () => {
  const isRoomLocked = useHostControlStore((s) => s.isRoomLocked);
  const setHostModalOpen = useHostControlStore((s) => s.setHostModalOpen);

  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const participants = usePresenceStore((s) => s.participants);
  const isLocalHost = hostId === localParticipantId || participants.get(localParticipantId || '')?.isHost;

  if (!isRoomLocked) return null;

  return (
    <button
      onClick={() => {
        if (isLocalHost) {
          setHostModalOpen(true, 'security');
        }
      }}
      disabled={!isLocalHost}
      title={
        isLocalHost
          ? 'Meeting is locked. Click to manage room security.'
          : 'Meeting is locked by the host.'
      }
      aria-label="Meeting is locked"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        backgroundColor: 'rgba(255, 71, 87, 0.15)',
        border: '1px solid rgba(255, 71, 87, 0.4)',
        borderRadius: '12px',
        padding: '2px 8px',
        color: '#ff4757',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: isLocalHost ? 'pointer' : 'default',
      }}
    >
      <span aria-hidden="true">🔒</span>
      <span>Locked</span>
    </button>
  );
};
