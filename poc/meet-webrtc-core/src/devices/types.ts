export type DeviceSettingsTab = 'audio' | 'video' | 'diagnostics';

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
  groupId: string;
  kind: MediaDeviceKind;
}

export interface AudioMeterState {
  level: number;       // 0 to 100
  isClipping: boolean; // level > 90
  isActive: boolean;
}

export interface LiveNetworkStats {
  transportType: 'direct-udp' | 'turn-udp' | 'turn-tcp' | 'turns-tls' | 'unknown';
  rttMs: number;
  packetLossPct: number;
  jitterMs: number;
  bitrateKbps: number;
  cipherSuite: string;
  currentEpoch: number;
  reconnectCount: number;
  sessionDurationSeconds: number;
}
