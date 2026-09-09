/**
 * Active Speaking Indicator (M2 Phase A)
 *
 * Lightweight visual indicator displaying speaking activity.
 * Driven directly by LiveKit active speaker events through PresenceStore.
 */

import React from 'react';

interface SpeakingIndicatorProps {
  isSpeaking: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const SpeakingIndicator: React.FC<SpeakingIndicatorProps> = ({
  isSpeaking,
  size = 'md',
}) => {
  if (!isSpeaking) return null;

  const barCount = size === 'sm' ? 3 : 4;
  const maxHeight = size === 'sm' ? 12 : size === 'lg' ? 18 : 14;

  return (
    <div
      className="speaking-indicator"
      role="status"
      aria-label="Speaking"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        height: `${maxHeight}px`,
      }}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: '2.5px',
            height: '100%',
            backgroundColor: 'var(--accent, #00d4aa)',
            borderRadius: '2px',
            animation: `speakingPulse 600ms ease-in-out infinite alternate`,
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
      <style>{`
        @keyframes speakingPulse {
          0% { transform: scaleY(0.3); opacity: 0.6; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
