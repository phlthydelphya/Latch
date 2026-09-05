/**
 * Connection Quality Badge (M2 Phase A)
 *
 * Renders standardized 4-bar connection strength indicator
 * driven by the Presence domain's ConnectionQualityAggregator.
 */

import React from 'react';
import { ConnectionQualityRating } from '../presence/types';
import { ConnectionQualityAggregator } from '../presence/connectionQuality';

interface ConnectionBadgeProps {
  quality?: ConnectionQualityRating;
  showLabel?: boolean;
}

export const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({
  quality = 'good',
  showLabel = false,
}) => {
  const details = ConnectionQualityAggregator.getRatingDetails(quality);

  return (
    <div
      className="connection-badge"
      title={`Connection: ${details.label}`}
      role="status"
      aria-label={`Connection quality: ${details.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '14px',
        }}
        aria-hidden="true"
      >
        {[1, 2, 3, 4].map((bar) => {
          const filled = bar <= details.bars;
          const height = `${bar * 3 + 2}px`;
          return (
            <div
              key={bar}
              style={{
                width: '3px',
                height,
                borderRadius: '1px',
                backgroundColor: filled ? details.colorHex : 'rgba(255, 255, 255, 0.2)',
                transition: 'background-color 200ms ease',
              }}
            />
          );
        })}
      </div>
      {showLabel && (
        <span style={{ fontSize: '0.75rem', color: details.colorHex, fontWeight: 500 }}>
          {details.label}
        </span>
      )}
    </div>
  );
};
