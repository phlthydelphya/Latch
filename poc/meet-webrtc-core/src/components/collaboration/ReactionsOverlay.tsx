import { useCollaborationStore } from '../../collaboration/collaborationStore';

export function ReactionsOverlay() {
  const activeReactions = useCollaborationStore((s) => s.activeReactions);

  if (activeReactions.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 40,
      }}
    >
      {activeReactions.map((rx) => (
        <div
          key={rx.id}
          style={{
            position: 'absolute',
            bottom: '90px',
            left: `${rx.xOffset ?? 50}%`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            animation: 'floatUpAndFade 3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
          }}
        >
          <span style={{ fontSize: '2.8rem', filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }}>
            {rx.emoji}
          </span>
          <span
            style={{
              fontSize: '0.7rem',
              color: '#fff',
              background: 'rgba(0,0,0,0.6)',
              borderRadius: '8px',
              padding: '2px 6px',
              backdropFilter: 'blur(4px)',
              marginTop: '-4px',
            }}
          >
            {rx.senderName}
          </span>
        </div>
      ))}

      <style>{`
        @keyframes floatUpAndFade {
          0% {
            opacity: 0;
            transform: translateY(20px) scale(0.6) rotate(0deg);
          }
          15% {
            opacity: 1;
            transform: translateY(-50px) scale(1.2) rotate(-6deg);
          }
          50% {
            opacity: 0.9;
            transform: translateY(-220px) scale(1.1) rotate(6deg);
          }
          100% {
            opacity: 0;
            transform: translateY(-480px) scale(0.9) rotate(-10deg);
          }
        }
      `}</style>
    </div>
  );
}
