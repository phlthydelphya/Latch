/**
 * Meeting Invitation Modal Dialog (M4A.1 INV-03)
 *
 * In-call modal for sharing meeting links, formatted invitation text,
 * and client-side vector QR codes for mobile participant onboarding.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { formatMeetingUrl, formatInvitationText } from '../utils/roomUrl';
import { generateQRCodeSVG } from '../utils/qr';

export interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  keyParam?: string;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
  roomId,
  keyParam,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [showQR, setShowQR] = useState(true);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const meetingUrl = useMemo(() => formatMeetingUrl(roomId, keyParam), [roomId, keyParam]);
  const invitationText = useMemo(() => formatInvitationText(roomId, keyParam), [roomId, keyParam]);

  const qrSvg = useMemo(() => {
    try {
      return generateQRCodeSVG(meetingUrl, {
        size: 180,
        margin: 3,
        color: '#000000',
        bgColor: '#ffffff',
        title: `QR Code for meeting ${roomId}`,
      });
    } catch {
      return null;
    }
  }, [meetingUrl, roomId]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(meetingUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback if clipboard API denied
    }
  };

  const handleCopyInvitation = async () => {
    try {
      await navigator.clipboard.writeText(invitationText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: 'var(--bg-surface, #14141e)',
          border: '1px solid var(--border, #28283c)',
          borderRadius: '16px',
          padding: '24px',
          width: '100%',
          maxWidth: '460px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          animation: 'fadeIn 150ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>🔗</span>
            <h2 id="invite-modal-title" style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: 'var(--fg, #eaeaea)' }}>
              Invite Participants
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close invite dialog"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--fg-muted, #888899)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '6px',
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted, #888899)', marginTop: 0, marginBottom: '20px', lineHeight: 1.4 }}>
          Share this link or QR code with attendees. Guests will be admitted according to your waiting room settings.
        </p>

        {/* Meeting Link Field */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-muted, #888899)', marginBottom: '6px', fontWeight: 600 }}>
            Meeting Link
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={meetingUrl}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--border, #28283c)',
                borderRadius: '8px',
                color: 'var(--fg, #eaeaea)',
                fontFamily: 'var(--font-mono, monospace)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onFocus={(e) => e.target.select()}
            />
            <button
              onClick={handleCopyLink}
              className="btn btn-primary"
              style={{
                padding: '8px 14px',
                fontSize: '0.85rem',
                fontWeight: 600,
                borderRadius: '8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                minWidth: '96px',
              }}
            >
              {copiedLink ? 'Copied! ✓' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          <button
            onClick={handleCopyInvitation}
            style={{
              flex: 1,
              padding: '8px 12px',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid var(--border, #28283c)',
              borderRadius: '8px',
              color: 'var(--fg, #eaeaea)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {copiedText ? 'Copied Invitation! ✓' : '📋 Copy Invitation'}
          </button>
          <button
            onClick={() => setShowQR((prev) => !prev)}
            style={{
              padding: '8px 14px',
              backgroundColor: showQR ? 'rgba(0, 212, 170, 0.15)' : 'rgba(255, 255, 255, 0.06)',
              border: showQR ? '1px solid rgba(0, 212, 170, 0.4)' : '1px solid var(--border, #28283c)',
              color: showQR ? '#00d4aa' : 'var(--fg, #eaeaea)',
              borderRadius: '8px',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            📱 {showQR ? 'Hide QR' : 'Show QR'}
          </button>
        </div>

        {/* QR Code Section */}
        {showQR && qrSvg && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: '16px',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border, #28283c)',
              borderRadius: '12px',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                padding: '12px',
                backgroundColor: '#ffffff',
                borderRadius: '10px',
                lineHeight: 0,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              }}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted, #888899)', marginTop: '12px', textAlign: 'center' }}>
              Scan with your phone camera to join the meeting instantly.
            </span>
          </div>
        )}

        {/* Ephemeral E2EE Security Footnote */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            padding: '10px 12px',
            backgroundColor: 'rgba(0, 212, 170, 0.06)',
            border: '1px solid rgba(0, 212, 170, 0.2)',
            borderRadius: '8px',
            fontSize: '0.75rem',
            color: 'var(--fg-muted, #888899)',
            lineHeight: 1.4,
          }}
        >
          <span style={{ color: '#00d4aa' }} aria-hidden="true">🛡️</span>
          <span>
            <strong>E2EE Secured:</strong> Meeting encryption keys are contained in the URL hash and processed strictly in-browser. Signaling servers never have access to invitation keys.
          </span>
        </div>
      </div>
    </div>
  );
};
