// tests/app.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/store/appStore';

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('manages room state', () => {
    useAppStore.getState().setRoom('test-room', 'p-123', 'jwt-token', 'key-param');
    expect(useAppStore.getState().roomId).toBe('test-room');
    expect(useAppStore.getState().participantId).toBe('p-123');
    expect(useAppStore.getState().jwt).toBe('jwt-token');
    expect(useAppStore.getState().keyParam).toBe('key-param');
    
    useAppStore.getState().clearRoom();
    expect(useAppStore.getState().roomId).toBeNull();
    expect(useAppStore.getState().participantId).toBeNull();
    expect(useAppStore.getState().jwt).toBeNull();
    expect(useAppStore.getState().keyParam).toBeNull();
  });

  it('manages participants', () => {
    useAppStore.getState().addParticipant({
      id: 'p-1',
      name: 'Alice',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isLocal: false,
      isSpeaking: false,
    });
    
    let participants = useAppStore.getState().participants;
    expect(participants.size).toBe(1);
    expect(participants.get('p-1')?.name).toBe('Alice');
    
    useAppStore.getState().updateParticipant('p-1', { audioEnabled: false });
    participants = useAppStore.getState().participants; // Refresh reference
    expect(participants.get('p-1')?.audioEnabled).toBe(false);
    
    useAppStore.getState().removeParticipant('p-1');
    participants = useAppStore.getState().participants; // Refresh reference
    expect(participants.size).toBe(0);
  });

  it('manages local participant', () => {
    useAppStore.getState().setLocalParticipant({
      id: 'p-local',
      name: 'You',
      audioEnabled: true,
      videoEnabled: true,
      screenSharing: false,
      isLocal: true,
      isSpeaking: false,
    });
    
    expect(useAppStore.getState().localParticipant?.id).toBe('p-local');
    
    useAppStore.getState().toggleLocalAudio();
    expect(useAppStore.getState().localParticipant?.audioEnabled).toBe(false);
    
    useAppStore.getState().toggleLocalAudio();
    expect(useAppStore.getState().localParticipant?.audioEnabled).toBe(true);
    
    useAppStore.getState().toggleLocalVideo();
    expect(useAppStore.getState().localParticipant?.videoEnabled).toBe(false);
    
    useAppStore.getState().setLocalScreenShare(true);
    expect(useAppStore.getState().localParticipant?.screenSharing).toBe(true);
  });

  it('manages connection state', () => {
    useAppStore.getState().setConnected(true);
    expect(useAppStore.getState().isConnected).toBe(true);
    expect(useAppStore.getState().connectionQuality).toBe('excellent');
    
    useAppStore.getState().setReconnecting(true);
    expect(useAppStore.getState().isReconnecting).toBe(true);
    expect(useAppStore.getState().connectionQuality).toBe('poor');
    
    useAppStore.getState().setReconnecting(false);
    expect(useAppStore.getState().isReconnecting).toBe(false);
    expect(useAppStore.getState().connectionQuality).toBe('excellent');
    
    useAppStore.getState().setConnectionQuality('poor');
    expect(useAppStore.getState().connectionQuality).toBe('poor');
  });

  it('manages shield mode and errors', () => {
    useAppStore.getState().setShieldMode(true);
    expect(useAppStore.getState().shieldMode).toBe(true);
    
    useAppStore.getState().setError('Test error');
    expect(useAppStore.getState().error).toBe('Test error');
    
    useAppStore.getState().setError(null);
    expect(useAppStore.getState().error).toBeNull();
  });
});