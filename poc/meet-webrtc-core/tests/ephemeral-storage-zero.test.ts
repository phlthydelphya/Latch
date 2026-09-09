// tests/ephemeral-storage-zero.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/appStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useLayoutStore } from '../src/layout/layoutStore';
import { useCollaborationStore } from '../src/collaboration/collaborationStore';
import { useDeviceStore } from '../src/devices/deviceStore';
import { useHostControlStore } from '../src/host/hostControlStore';

describe('DEBT-SEC-01: Zero Persistence Verification', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('guarantees zero bytes in sessionStorage during entire meeting lifecycle', () => {
    expect(sessionStorage.length).toBe(0);

    // Join room with sensitive keyParam and JWT
    useAppStore.getState().setRoom('secret-room', 'p-participant', 'jwt-secret-token', 'sframe-passphrase-k1');
    useAppStore.getState().setCredentials('livekit-access-jwt', 'wss://sfu.meet.internal/rtc');
    useAppStore.getState().setConnected(true);

    // In-memory state is active
    expect(useAppStore.getState().roomId).toBe('secret-room');
    expect(useAppStore.getState().keyParam).toBe('sframe-passphrase-k1');
    expect(useAppStore.getState().livekitToken).toBe('livekit-access-jwt');

    // ASSERT: sessionStorage is strictly empty
    expect(sessionStorage.length).toBe(0);
    expect(sessionStorage.getItem('meet-secure-state')).toBeNull();

    // Mutate state with participant activity
    useAppStore.getState().addParticipant({
      id: 'p-2',
      name: 'Bob',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isLocal: false,
      isSpeaking: false,
    });

    expect(sessionStorage.length).toBe(0);

    // Leave meeting
    useAppStore.getState().leave();
    expect(useAppStore.getState().roomId).toBeNull();
    expect(useAppStore.getState().keyParam).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('guarantees zero bytes in localStorage during entire meeting lifecycle', () => {
    expect(localStorage.length).toBe(0);

    useAppStore.getState().setRoom('room-123', 'p-123', 'jwt-val', 'key-val');
    useAppStore.getState().setConnected(true);

    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('meet-secure-state')).toBeNull();

    useAppStore.getState().leave();
    expect(localStorage.length).toBe(0);
  });

  it('confirms all domain stores are 100% ephemeral in-memory without persistence plugins', () => {
    // Verify PresenceStore
    usePresenceStore.getState().upsertParticipant({
      id: 'p-1',
      name: 'Alice',
      isSpeaking: false,
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
    });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    // Verify LayoutStore
    useLayoutStore.getState().setLayoutMode('speaker');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    // Verify CollaborationStore
    useCollaborationStore.getState().addMessage({
      id: 'msg-1',
      senderId: 'p-1',
      senderName: 'Alice',
      content: 'Confidential message',
      timestamp: Date.now(),
      isLocal: true,
    });
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    // Verify DeviceStore
    useDeviceStore.getState().setMicLevel(0.85);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);

    // Verify HostControlStore
    useHostControlStore.getState().setRoomLocked(true);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });
});
