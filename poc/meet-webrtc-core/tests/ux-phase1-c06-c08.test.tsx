/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ControlBar } from '../src/components/ControlBar';
import { HostControlManager } from '../src/host/hostControlManager';
import { useAppStore } from '../src/store/appStore';
import { useHostControlStore } from '../src/host/hostControlStore';
import { usePresenceStore } from '../src/presence/presenceStore';

const participant = (id: string, isLocal: boolean) => ({
  id, name: isLocal ? 'Host' : 'Successor', isLocal, isHost: isLocal,
  audioEnabled: false, videoEnabled: false, microphoneState: 'muted' as const,
  cameraState: 'muted' as const, screenSharing: false, isSpeaking: false,
  connectionQuality: 'good' as const, isHandRaised: false, joinedAt: isLocal ? 1 : 2,
});

describe('UX-PHASE1 C06/C08', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState(useAppStore.getInitialState());
    usePresenceStore.getState().resetPresence();
    useHostControlStore.getState().reset();
    useAppStore.setState({ isConnected: true, localParticipant: {
      id: 'host-1', name: 'Host', audioEnabled: false, videoEnabled: false,
      screenSharing: false, isLocal: true, isSpeaking: false,
    }});
    usePresenceStore.setState({ localParticipantId: 'host-1', hostId: 'host-1', participants: new Map([
      ['host-1', participant('host-1', true)], ['peer-2', participant('peer-2', false)],
    ]) });
  });

  it('C06: controls invoke WebRTC commands and render publication-backed state', async () => {
    const onToggleAudio = vi.fn(async () => usePresenceStore.getState().updateParticipantTracks('host-1', { microphoneState: 'on' }));
    const onToggleVideo = vi.fn(async () => usePresenceStore.getState().updateParticipantTracks('host-1', { cameraState: 'on' }));
    render(<ControlBar onToggleAudio={onToggleAudio} onToggleVideo={onToggleVideo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on camera' }));
    expect(onToggleAudio).toHaveBeenCalledTimes(1);
    expect(onToggleVideo).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mute microphone' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: 'Turn off camera' }).getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('C08: failed transfer keeps host in session and permits retry', async () => {
    const transferHost = vi.spyOn(HostControlManager.getInstance(), 'transferHost')
      .mockRejectedValueOnce(new Error('authority unavailable')).mockResolvedValueOnce(undefined);
    const onLeave = vi.fn().mockResolvedValue(undefined);
    render(<ControlBar onLeave={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer & Leave' }));
    expect((await screen.findByRole('alert')).textContent).toContain('still in the meeting');
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer & Leave' }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
    expect(transferHost).toHaveBeenCalledTimes(2);
  });
});
