import { useEffect, useState } from 'react';
import '../styles/support-theme.css';

export function LoadingScreen() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    // Hide after initial paint - PWA shell should load instantly
    const timer = setTimeout(() => setShow(false), 100);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="loading-overlay" role="status" aria-label="Loading application">
      <div className="loading-spinner" aria-hidden="true" />
      <span>Loading Latch…</span>
    </div>
  );
}
