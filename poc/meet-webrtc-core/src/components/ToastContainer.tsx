/**
 * Ephemeral Toast Container (M2 Phase A)
 *
 * Displays ephemeral, accessible meeting notification toasts
 * (join, leave, hand raise, host transfer).
 *
 * Invariants:
 * - 100% ephemeral: auto-dismisses after durationMs, zero persistent history.
 */

import React, { useEffect } from 'react';
import '../styles/support-theme.css';
import { usePresenceStore } from '../presence/presenceStore';
import { EphemeralToast } from '../presence/types';

export const ToastContainer: React.FC = () => {
  const toastQueue = usePresenceStore((s) => s.toastQueue);
  const dismissToast = usePresenceStore((s) => s.dismissToast);

  return (
    <div
      className="toast-container"
      role="region"
      aria-label="Meeting Notifications"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        maxWidth: '360px',
      }}
    >
      {toastQueue.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </div>
  );
};

interface ToastItemProps {
  toast: EphemeralToast;
  onDismiss: () => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, toast.durationMs || 4000);
    return () => clearTimeout(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  const getBadgeStyle = () => {
    switch (toast.type) {
      case 'join':
        return { borderLeft: '4px solid var(--accent, #00d4aa)', icon: '🟢' };
      case 'leave':
        return { borderLeft: '4px solid var(--fg-muted, #888899)', icon: '⚪' };
      case 'hand':
        return { borderLeft: '4px solid var(--warning, #ffa502)', icon: '✋' };
      case 'host':
        return { borderLeft: '4px solid #f59e0b', icon: '👑' };
      default:
        return { borderLeft: '4px solid #3b82f6', icon: 'ℹ️' };
    }
  };

  const badge = getBadgeStyle();

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        pointerEvents: 'auto',
        backgroundColor: 'rgba(17, 17, 26, 0.95)',
        backdropFilter: 'blur(12px)',
        color: 'var(--fg, #eaeaea)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-sm, 8px)',
        border: '1px solid var(--border, #222233)',
        ...badge,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '0.875rem',
        animation: 'toastSlideIn 200ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span aria-hidden="true">{badge.icon}</span>
        <div>
          <strong style={{ fontWeight: 600 }}>{toast.title}</strong>
          {toast.message && (
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fg-muted, #888899)' }}>
              {toast.message}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          color: 'var(--fg-muted, #888899)',
          fontSize: '1rem',
          padding: '2px 6px',
          borderRadius: '4px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
      <style>{`
        @keyframes toastSlideIn {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
