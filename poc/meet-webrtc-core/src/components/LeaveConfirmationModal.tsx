/**
 * Leave Confirmation & Host Departure Governance Modal (M4A Deliverable 5.3)
 *
 * Ephemeral modal preventing accidental disconnects and governing host departure:
 * - Participant: "Leave Meeting? [Cancel] [Leave Meeting]"
 * - Host:
 *   - If other participants are present: "Host Departure [Cancel] [Transfer & Leave] [Leave]"
 *     Allows host to transfer authority before departure or initiate graceful succession.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';

export interface LeaveConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmLeave: () => Promise<void> | void;
  onTransferAndLeave?: (targetParticipantId: string) => Promise<void> | void;
  isHost: boolean;
}

export const LeaveConfirmationModal: React.FC<LeaveConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirmLeave,
  onTransferAndLeave,
  isHost,
}) => {
  const participants = usePresenceStore((s) => Array.from(s.participants.values()));
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const waitingQueue = useHostControlStore((s) => s.waitingQueue);

  // Filter remote participants who can be transferred authority (excluding unadmitted lobby participants)
  const remoteParticipants = useMemo(() => {
    const waitingIds = new Set(waitingQueue.map((w) => w.participantId));
    return participants.filter((p) => p.id !== localParticipantId && !waitingIds.has(p.id));
  }, [participants, localParticipantId, waitingQueue]);

  const [selectedSuccessorId, setSelectedSuccessorId] = useState<string>('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsTransferring(false);
      setTransferError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (remoteParticipants.length > 0 && (!selectedSuccessorId || !remoteParticipants.some((p) => p.id === selectedSuccessorId))) {
      setSelectedSuccessorId(remoteParticipants[0].id);
    }
  }, [remoteParticipants, selectedSuccessorId]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="meeting-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leave-modal-title"
      aria-describedby="leave-modal-description"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 150ms ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: 'var(--bg-elevated, #14141e)',
          border: '1px solid var(--border, #28283c)',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
            <span style={{ fontSize: '1.25rem' }}>{isHost ? '🛡️' : '🚪'}</span>
            <h2
              id="leave-modal-title"
              style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: 'var(--fg, #eaeaea)' }}
            >
              {isHost ? 'Host Departure' : 'Leave Meeting?'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
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

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {isHost ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p id="leave-modal-description" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)', lineHeight: 1.5 }}>
                You are the meeting host. Leaving will transfer host authority to another participant or end the session.
              </p>

              {remoteParticipants.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label htmlFor="successor-select" style={{ fontSize: '0.8rem', color: 'var(--fg-muted, #888899)', fontWeight: 500 }}>
                    Select new host to transfer authority to:
                  </label>
                  <select
                    id="successor-select"
                    className="input-field"
                    value={selectedSuccessorId}
                    onChange={(e) => setSelectedSuccessorId(e.target.value)}
                    disabled={isTransferring}
                    style={{ width: '100%' }}
                  >
                    {remoteParticipants.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {transferError && (
                <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--danger)', lineHeight: 1.4 }}>
                  {transferError}
                </p>
              )}
            </div>
          ) : (
            <p id="leave-modal-description" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--fg, #eaeaea)', lineHeight: 1.5 }}>
              Are you sure you want to leave the meeting?
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid var(--border, #28283c)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isTransferring}
          >
            Cancel
          </button>

          {isHost ? (
            <>
              {remoteParticipants.length > 0 && onTransferAndLeave && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    if (!selectedSuccessorId || isTransferring) return;
                    setIsTransferring(true);
                    setTransferError(null);
                    try {
                      await onTransferAndLeave(selectedSuccessorId);
                    } catch {
                      setTransferError('Host transfer failed. You are still in the meeting. Try again or cancel.');
                    } finally {
                      setIsTransferring(false);
                    }
                  }}
                  disabled={isTransferring || !selectedSuccessorId}
                >
                  {isTransferring ? 'Transferring…' : 'Transfer & Leave'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger"
                onClick={onConfirmLeave}
              >
                Leave
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onConfirmLeave}
            >
              Leave Meeting
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
