import { create } from 'zustand';
import { MeetingPermissions, WaitingParticipant, DEFAULT_PERMISSIONS } from './types';

export interface HostControlState {
  isRoomLocked: boolean;
  isWaitingRoomEnabled: boolean;
  waitingQueue: WaitingParticipant[];
  permissions: MeetingPermissions;
  isHostModalOpen: boolean;
  activeTab: 'security' | 'permissions';
  isKicked: boolean;

  setRoomLocked: (locked: boolean) => void;
  setWaitingRoomEnabled: (enabled: boolean) => void;
  addWaitingParticipant: (p: WaitingParticipant) => void;
  removeWaitingParticipant: (participantId: string) => void;
  clearWaitingQueue: () => void;
  updatePermissions: (perms: Partial<MeetingPermissions>) => void;
  setHostModalOpen: (open: boolean, tab?: 'security' | 'permissions') => void;
  setActiveTab: (tab: 'security' | 'permissions') => void;
  setKicked: (kicked: boolean) => void;
  reset: () => void;
}

const initialState = {
  isRoomLocked: false,
  isWaitingRoomEnabled: false,
  waitingQueue: [] as WaitingParticipant[],
  permissions: { ...DEFAULT_PERMISSIONS },
  isHostModalOpen: false,
  activeTab: 'security' as 'security' | 'permissions',
  isKicked: false,
};

export const useHostControlStore = create<HostControlState>((set) => ({
  ...initialState,

  setRoomLocked: (locked) => set({ isRoomLocked: locked }),

  setWaitingRoomEnabled: (enabled) =>
    set((state) => ({
      isWaitingRoomEnabled: enabled,
      waitingQueue: enabled ? state.waitingQueue : [],
    })),

  addWaitingParticipant: (p) =>
    set((state) => {
      if (state.waitingQueue.some((item) => item.participantId === p.participantId)) {
        return state;
      }
      return { waitingQueue: [...state.waitingQueue, p] };
    }),

  removeWaitingParticipant: (participantId) =>
    set((state) => ({
      waitingQueue: state.waitingQueue.filter((p) => p.participantId !== participantId),
    })),

  clearWaitingQueue: () => set({ waitingQueue: [] }),

  updatePermissions: (perms) =>
    set((state) => ({
      permissions: {
        ...state.permissions,
        ...perms,
      },
    })),

  setHostModalOpen: (open, tab) =>
    set((state) => ({
      isHostModalOpen: open,
      activeTab: tab || state.activeTab,
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setKicked: (kicked) => set({ isKicked: kicked }),

  reset: () =>
    set({
      ...initialState,
      permissions: { ...DEFAULT_PERMISSIONS },
      waitingQueue: [],
    }),
}));
