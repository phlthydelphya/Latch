/**
 * Permissions hook + co-host registry.
 *
 * Single source of truth for "who may moderate whom" in the UI layer:
 * - Host identity comes from presenceStore.hostId (M4A server-authoritative
 *   source of truth: `isHost = hostId !== null && hostId === localParticipantId`).
 * - Co-host membership lives in the zustand registry below, mirrored by
 *   HostControlManager when verified `assign-cohost` / `revoke-cohost` /
 *   `role-changed` directives arrive.
 *
 * Moderation hierarchy (mirrors HostControlManager directive enforcement):
 *   Host > Co-Host > Participant.
 *   Co-hosts may never moderate equal-or-higher-tier participants
 *   (the host or other co-hosts).
 */

import { useCallback, useMemo } from 'react';
import { create } from 'zustand';
import { usePresenceStore } from '../presence/presenceStore';
import { useHostControlStore } from '../host/hostControlStore';

export interface PermissionsState {
  /** Participant IDs currently holding the co-host role. */
  coHostIds: Set<string>;
  addCoHost: (participantId: string) => void;
  removeCoHost: (participantId: string) => void;
  setCoHosts: (participantIds: string[]) => void;
  reset: () => void;
}

export const usePermissionsStore = create<PermissionsState>((set) => ({
  coHostIds: new Set<string>(),

  addCoHost: (participantId) =>
    set((state) => {
      if (state.coHostIds.has(participantId)) return state;
      const next = new Set(state.coHostIds);
      next.add(participantId);
      return { coHostIds: next };
    }),

  removeCoHost: (participantId) =>
    set((state) => {
      if (!state.coHostIds.has(participantId)) return state;
      const next = new Set(state.coHostIds);
      next.delete(participantId);
      return { coHostIds: next };
    }),

  setCoHosts: (participantIds) => set({ coHostIds: new Set(participantIds) }),

  reset: () => set({ coHostIds: new Set<string>() }),
}));

export interface PermissionsContext {
  /** True iff the local participant is the authoritative meeting host. */
  isHost: boolean;
  /** True iff the local participant currently holds the co-host role. */
  isCoHost: boolean;
  /** Host or co-host — may exercise moderation affordances in the UI. */
  isPrivileged: boolean;
  /** Privileged users always may share; participants follow meeting permissions. */
  canShareScreen: boolean;
  /** May the local user moderate (mute/remove/stop-share) this participant? */
  canModerateParticipant: (participantId: string) => boolean;
  /** Is the given participant the authoritative host? */
  isParticipantHost: (participantId: string) => boolean;
  /** Is the given participant a co-host? */
  isParticipantCoHost: (participantId: string) => boolean;
}

export function usePermissions(): PermissionsContext {
  const hostId = usePresenceStore((s) => s.hostId);
  const localParticipantId = usePresenceStore((s) => s.localParticipantId);
  const coHostIds = usePermissionsStore((s) => s.coHostIds);
  const participantsCanShareScreen = useHostControlStore((s) => s.permissions.canShareScreen);

  const isHost = hostId !== null && hostId === localParticipantId;
  const isCoHost = localParticipantId !== null && coHostIds.has(localParticipantId);
  const isPrivileged = isHost || isCoHost;
  const canShareScreen = isPrivileged || participantsCanShareScreen;

  const isParticipantHost = useCallback(
    (participantId: string) => hostId !== null && hostId === participantId,
    [hostId]
  );

  const isParticipantCoHost = useCallback(
    (participantId: string) => coHostIds.has(participantId),
    [coHostIds]
  );

  const canModerateParticipant = useCallback(
    (participantId: string) => {
      if (!isPrivileged) return false;
      if (!participantId || participantId === localParticipantId) return false;
      if (isHost) return true;
      // Co-hosts cannot moderate equal-or-higher-tier participants.
      return !(hostId !== null && hostId === participantId) && !coHostIds.has(participantId);
    },
    [isPrivileged, isHost, hostId, coHostIds, localParticipantId]
  );

  return useMemo(
    () => ({
      isHost,
      isCoHost,
      isPrivileged,
      canShareScreen,
      canModerateParticipant,
      isParticipantHost,
      isParticipantCoHost,
    }),
    [
      isHost,
      isCoHost,
      isPrivileged,
      canShareScreen,
      canModerateParticipant,
      isParticipantHost,
      isParticipantCoHost,
    ]
  );
}
