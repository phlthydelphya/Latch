import React, { useEffect, useState } from 'react';
import '../styles/support-theme.css';
import { onSWUpdate, applySWUpdate, isUpdateAvailable } from '../sw-register';

export function ReloadPrompt() {
  const [showPrompt, setShowPrompt] = useState(isUpdateAvailable());
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const cleanup = onSWUpdate(() => {
      setShowPrompt(true);
    });
    return cleanup;
  }, []);

  if (!showPrompt) {
    return null;
  }

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await applySWUpdate();
    } catch (err) {
      console.error('[SW] Failed to apply update:', err);
      setUpdating(false);
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  return (
    <aside
      aria-label="App update available"
      className="pwa-update-prompt"
      role="region"
    >
      <div className="pwa-update-prompt__content">
        <span className="pwa-update-prompt__icon" aria-hidden="true">
          ✨
        </span>
        <div className="pwa-update-prompt__text">
          <strong>New version available</strong>
          <span>An update is ready with performance and security improvements.</span>
        </div>
      </div>
      <div className="pwa-update-prompt__actions">
        <button
          type="button"
          className="btn btn-primary pwa-update-prompt__btn-update"
          onClick={handleUpdate}
          disabled={updating}
        >
          {updating ? 'Updating…' : 'Update now'}
        </button>
        <button
          type="button"
          className="btn btn-secondary pwa-update-prompt__btn-dismiss"
          onClick={handleDismiss}
          disabled={updating}
          aria-label="Dismiss update banner"
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
