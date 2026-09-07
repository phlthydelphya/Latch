import { create } from 'zustand';
import { MeetingPermissions, WaitingParticipant, DEFAULT_PERMISSIONS } from './types';

export interface HostControlState {
  isRoomLocked: boolean;
  isWaitingRoomEnabled: boolean;
  isWaitingInLobby: boolean;
  waitingQueue: WaitingParticipant[];
  admittedParticipants: Set<string>;
  permissions: MeetingPermissions;
  isHostModalOpen: boolean;
  activeTab: 'security' | 'permissions';
  isKicked: boolean;

  setRoomLocked: (locked: boolean) => void;
  setWaitingRoomEnabled: (enabled: boolean) => void;
  setIsWaitingInLobby: (waiting: boolean) => void;
  addWaitingParticipant: (p: WaitingParticipant) => void;
  removeWaitingParticipant: (participantId: string) => void;
  admitParticipantId: (participantId: string) => void;
  clearWaitingQueue: () => void;
  updatePermissions: (perms: Partial<MeetingPermissions>) => void;
  setHostModalOpen: (open: boolean, tab?: 'security' | 'permissions') => void;
  setActiveTab: (tab: 'security' | 'permissions') => void;
  setKicked: (kicked: boolean) => void;
  reset: () => void;
}

const initialState = {
  isRoomLocked: false,
  isWaitingRoomEnabled: true,
  isWaitingInLobby: false,
  waitingQueue: [] as WaitingParticipant[],
  admittedParticipants: new Set<string>(),
  permissions: { ...DEFAULT_PERMISSIONS },
  isHostModalOpen: false,
  activeTab: 'security' as 'security' | 'permissions',
  isKicked: false,
};

export const useHostControlStore = create<HostControlState>((set) => ({
  ...initialState,

  setRoomLocked: (locked) => set({ isRoomLocked: locked }),

  setWaitingRoomEnabled: (enabled) =>
    set((state) => {
      if (!enabled) {
        const nextAdmitted = new Set(state.admittedParticipants);
        for (const p of state.waitingQueue) {
          nextAdmitted.add(p.participantId);
        }
        return {
          isWaitingRoomEnabled: false,
          isWaitingInLobby: false,
          waitingQueue: [],
          admittedParticipants: nextAdmitted,
        };
      }
      return {
        isWaitingRoomEnabled: true,
      };
    }),

  setIsWaitingInLobby: (waiting) => set({ isWaitingInLobby: waiting }),

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

  admitParticipantId: (participantId) =>
    set((state) => {
      const next = new Set(state.admittedParticipants);
      next.add(participantId);
      return {
        admittedParticipants: next,
        waitingQueue: state.waitingQueue.filter((p) => p.participantId !== participantId),
      };
    }),

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
      admittedParticipants: new Set<string>(),
      permissions: { ...DEFAULT_PERMISSIONS },
      waitingQueue: [],
    }),
}));
