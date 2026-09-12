export interface MeetingPermissions {
  canChat: boolean;        // Allow participants to send in-call chat messages
  canReact: boolean;       // Allow participants to send emoji reactions
  canShareScreen: boolean; // Allow participants to share their screen
  canUnmuteSelf: boolean;  // Allow participants to unmute their own microphone
}

export interface WaitingParticipant {
  participantId: string;
  name: string;
  timestamp: number;
}

export type HostDirectiveAction =
  | 'mute-participant'
  | 'remove-participant'
  | 'transfer-host'
  | 'host-changed'
  | 'lock-room'
  | 'set-waiting-room'
  | 'waiting-room-knock'
  | 'waiting-room-admit'
  | 'waiting-room-reject'
  | 'update-permissions'
  | 'host-announce'
  | 'host-query';

export interface HostDirectiveMessage {
  type: 'host-directive';
  action: HostDirectiveAction;
  targetParticipantId?: string;
  senderId?: string;
  hostToken?: string;          // M4A: Server-signed ES256 host claim
  newHostId?: string;          // For host-changed events (announcement only)
  hostKey?: string;            // Public host verification key (not secret)
  isLocked?: boolean;
  isWaitingRoomEnabled?: boolean;
  participantName?: string;
  permissions?: Partial<MeetingPermissions>;
  nonce?: string;
  timestamp: number;
}

export const HOST_CONTROL_TOPIC = 'collab-host-control';

export const DEFAULT_PERMISSIONS: MeetingPermissions = {
  canChat: true,
  canReact: true,
  canShareScreen: true,
  canUnmuteSelf: true,
};
