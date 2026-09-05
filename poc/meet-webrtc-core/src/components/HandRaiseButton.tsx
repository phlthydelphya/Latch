/**
 * Hand Raise Button (M2 Phase A)
 *
 * Ephemeral meeting control allowing participants to signal a question
 * without interrupting the active speaker.
 *
 * Dispatches via reliable DataChannel; zero persistence.
 */

import React from 'react';
import { usePresenceStore } from '../presence/presenceStore';

interface HandRaiseButtonProps {
  onToggleHand?: (raised: boolean) => Promise<void> | void;
  disabled?: boolean;
}

export const HandRaiseButton: React.FC<HandRaiseButtonProps> = ({
  onToggleHand,
  disabled = false,
}) => {
  const localId = usePresenceStore((s) => s.localParticipantId);
  const isHandRaised = usePresenceStore((s) => 
    localId ? Boolean(s.participants.get(localId)?.isHandRaised) : false
  );

  const handleClick = async () => {
    if (disabled) return;
    const nextState = !isHandRaised;
    if (onToggleHand) {
      await onToggleHand(nextState);
    } else if (localId) {
      usePresenceStore.getState().setHandRaised(localId, nextState);
    }
  };

  return (
    <button
      className={`media-toggle ${isHandRaised ? 'active' : ''}`}
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={isHandRaised}
      aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}
      title={isHandRaised ? 'Lower your hand' : 'Raise your hand'}
      style={{
        backgroundColor: isHandRaised ? 'rgba(255, 165, 2, 0.25)' : undefined,
        borderColor: isHandRaised ? 'var(--warning, #ffa502)' : undefined,
        color: isHandRaised ? 'var(--warning, #ffa502)' : undefined,
        position: 'relative',
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
      {isHandRaised && (
        <span
          style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--warning, #ffa502)',
          }}
        />
      )}
    </button>
  );
};
