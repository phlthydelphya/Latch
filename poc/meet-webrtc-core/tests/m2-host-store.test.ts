import { describe, it, expect, beforeEach } from 'vitest';
import { useHostControlStore } from '../src/host/hostControlStore';
import { DEFAULT_PERMISSIONS, WaitingParticipant } from '../src/host/types';

describe('M2 Phase E: HostControlStore', () => {
  beforeEach(() => {
    useHostControlStore.getState().reset();
  });

  it('E-1: Initializes with default open policy and empty queue', () => {
    const state = useHostControlStore.getState();
    expect(state.isRoomLocked).toBe(false);
    expect(state.isWaitingRoomEnabled).toBe(false);
    expect(state.waitingQueue).toEqual([]);
    expect(state.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(state.isHostModalOpen).toBe(false);
    expect(state.activeTab).toBe('security');
    expect(state.isKicked).toBe(false);
  });

  it('E-2: Toggles meeting lock state', () => {
    useHostControlStore.getState().setRoomLocked(true);
    expect(useHostControlStore.getState().isRoomLocked).toBe(true);

    useHostControlStore.getState().setRoomLocked(false);
    expect(useHostControlStore.getState().isRoomLocked).toBe(false);
  });

  it('E-3: Toggles waiting room and clears queue when disabled', () => {
    useHostControlStore.getState().setWaitingRoomEnabled(true);
    expect(useHostControlStore.getState().isWaitingRoomEnabled).toBe(true);

    useHostControlStore.getState().addWaitingParticipant({
      participantId: 'guest-1',
      name: 'Guest One',
      timestamp: 12345,
    });
    expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);

    // Disabling waiting room purges waitingQueue
    useHostControlStore.getState().setWaitingRoomEnabled(false);
    expect(useHostControlStore.getState().isWaitingRoomEnabled).toBe(false);
    expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);
  });

  it('E-4: Adds waiting participants and deduplicates by participantId', () => {
    const p1: WaitingParticipant = { participantId: 'p1', name: 'Alice', timestamp: 1000 };
    const p2: WaitingParticipant = { participantId: 'p2', name: 'Bob', timestamp: 2000 };
    const p1Duplicate: WaitingParticipant = { participantId: 'p1', name: 'Alice 2', timestamp: 3000 };

    useHostControlStore.getState().addWaitingParticipant(p1);
    useHostControlStore.getState().addWaitingParticipant(p2);
    useHostControlStore.getState().addWaitingParticipant(p1Duplicate);

    const queue = useHostControlStore.getState().waitingQueue;
    expect(queue).toHaveLength(2);
    expect(queue[0].name).toBe('Alice');
    expect(queue[1].name).toBe('Bob');
  });

  it('E-5: Removes waiting participant by ID', () => {
    useHostControlStore.getState().addWaitingParticipant({ participantId: 'p1', name: 'Alice', timestamp: 1000 });
    useHostControlStore.getState().addWaitingParticipant({ participantId: 'p2', name: 'Bob', timestamp: 2000 });

    useHostControlStore.getState().removeWaitingParticipant('p1');
    const queue = useHostControlStore.getState().waitingQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].participantId).toBe('p2');
  });

  it('E-6: Clears entire waiting queue', () => {
    useHostControlStore.getState().addWaitingParticipant({ participantId: 'p1', name: 'Alice', timestamp: 1000 });
    useHostControlStore.getState().addWaitingParticipant({ participantId: 'p2', name: 'Bob', timestamp: 2000 });

    useHostControlStore.getState().clearWaitingQueue();
    expect(useHostControlStore.getState().waitingQueue).toEqual([]);
  });

  it('E-7: Updates permissions partially', () => {
    useHostControlStore.getState().updatePermissions({ canChat: false, canShareScreen: false });

    const perms = useHostControlStore.getState().permissions;
    expect(perms.canChat).toBe(false);
    expect(perms.canShareScreen).toBe(false);
    expect(perms.canReact).toBe(true);
    expect(perms.canUnmuteSelf).toBe(true);

    useHostControlStore.getState().updatePermissions({ canUnmuteSelf: false });
    expect(useHostControlStore.getState().permissions.canUnmuteSelf).toBe(false);
  });

  it('E-8: Controls host modal visibility and active tab', () => {
    useHostControlStore.getState().setHostModalOpen(true, 'permissions');
    expect(useHostControlStore.getState().isHostModalOpen).toBe(true);
    expect(useHostControlStore.getState().activeTab).toBe('permissions');

    useHostControlStore.getState().setActiveTab('security');
    expect(useHostControlStore.getState().activeTab).toBe('security');

    useHostControlStore.getState().setHostModalOpen(false);
    expect(useHostControlStore.getState().isHostModalOpen).toBe(false);
  });

  it('E-9: Tracks kicked state', () => {
    expect(useHostControlStore.getState().isKicked).toBe(false);
    useHostControlStore.getState().setKicked(true);
    expect(useHostControlStore.getState().isKicked).toBe(true);
  });

  it('E-10: Purges all ephemeral state back to initial on reset()', () => {
    useHostControlStore.getState().setRoomLocked(true);
    useHostControlStore.getState().setWaitingRoomEnabled(true);
    useHostControlStore.getState().addWaitingParticipant({ participantId: 'p1', name: 'Alice', timestamp: 1000 });
    useHostControlStore.getState().updatePermissions({ canChat: false, canReact: false });
    useHostControlStore.getState().setHostModalOpen(true, 'permissions');
    useHostControlStore.getState().setKicked(true);

    useHostControlStore.getState().reset();

    const state = useHostControlStore.getState();
    expect(state.isRoomLocked).toBe(false);
    expect(state.isWaitingRoomEnabled).toBe(false);
    expect(state.waitingQueue).toEqual([]);
    expect(state.permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(state.isHostModalOpen).toBe(false);
    expect(state.activeTab).toBe('security');
    expect(state.isKicked).toBe(false);
  });
});
