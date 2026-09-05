import { useCollaborationStore } from '../../collaboration/collaborationStore';

export function HostAnnouncementBanner() {
  const currentAnnouncement = useCollaborationStore((s) => s.currentAnnouncement);
  const dismissAnnouncement = useCollaborationStore((s) => s.dismissAnnouncement);

  if (!currentAnnouncement || !currentAnnouncement.active) return null;

  return (
    <div
      role="banner"
      aria-label="Host announcement"
      style={{
        position: 'fixed',
        top: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90%',
        maxWidth: '800px',
        zIndex: 55,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 18px',
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.95), rgba(217, 119, 6, 0.95))',
        color: '#000',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(245, 158, 11, 0.4)',
        animation: 'slideDown 200ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem' }}>📢</span>
        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Announcement from {currentAnnouncement.senderName}
          </span>
          <p style={{ margin: '2px 0 0 0', fontSize: '0.95rem', fontWeight: 600 }}>
            {currentAnnouncement.message}
          </p>
        </div>
      </div>

      <button
        onClick={dismissAnnouncement}
        aria-label="Dismiss announcement"
        style={{
          background: 'rgba(0,0,0,0.15)',
          border: 'none',
          borderRadius: '6px',
          color: '#000',
          cursor: 'pointer',
          padding: '4px 8px',
          fontSize: '1rem',
          fontWeight: 700,
        }}
      >
        ✕
      </button>

      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
