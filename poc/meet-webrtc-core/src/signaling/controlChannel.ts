/**
 * ControlChannelManager — dedicated signaling path for SEC-02B/SEC-02C private
 * host-credential delivery.
 *
 * The activated meet-signal contract delivers a transferred host's ES256
 * operation proof and one-use resume handle only to the target's authenticated
 * signaling connection (never broadcast, never returned to the outgoing host).
 * This manager owns that WebSocket lifecycle: a singleton connection with
 * reconnect support, target-only application of received credentials, duplicate
 * suppression, and full cleanup on room leave.
 *
 * Private credentials are never logged.
 */

import { SignalingClient } from './client';
import { useAppStore } from '../store/appStore';
import { usePresenceStore } from '../presence/presenceStore';
import { HostControlManager } from '../host/hostControlManager';

export interface HostCredentialPayload {
  hostToken?: string;
  hostKey?: string;
  roomInstanceId?: string;
  generation?: number;
  resumeHandle?: string;
}

export interface ControlChannelConfig {
  url: string;
  roomId: string;
  participantId: string;
  jwt: string;
}

/** Resolves the meet-signal WSS /signal URL for the current deployment. */
export function resolveSignalingUrl(): string {
  const envUrl = import.meta.env.VITE_SIGNAL_URL;
  if (envUrl) {
    return envUrl;
  }
  if (typeof location === 'undefined') {
    return 'ws://127.0.0.1:8080/signal';
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/signal`;
}

export class ControlChannelManager {
  private static instance: ControlChannelManager | null = null;

  private client: SignalingClient | null = null;
  private roomId: string | null = null;
  private participantId: string | null = null;
  private jwt: string | null = null;
  private lastAppliedKey: string | null = null;
  private deliveryCount = 0;
  private handler: ((payload: HostCredentialPayload) => void) | null = null;

  static getInstance(): ControlChannelManager {
    if (!ControlChannelManager.instance) {
      ControlChannelManager.instance = new ControlChannelManager();
    }
    return ControlChannelManager.instance;
  }

  /**
   * Connects (or reconnects) the singleton control channel. Calling this again
   * for the same room/participant/token is a no-op, preventing duplicate
   * listeners and duplicate connections.
   */
  connect(config: ControlChannelConfig): void {
    if (typeof WebSocket === 'undefined') {
      // Non-browser/test environment without a WebSocket implementation.
      return;
    }
    if (!config.url || !config.roomId || !config.participantId || !config.jwt) {
      return;
    }

    const unchanged =
      this.client !== null &&
      this.roomId === config.roomId &&
      this.participantId === config.participantId &&
      this.jwt === config.jwt;
    if (unchanged && this.client?.isConnected()) {
      return;
    }

    // Tear down any previous connection (token rotation, room change, reconnect).
    this.disconnect();

    this.roomId = config.roomId;
    this.participantId = config.participantId;
    this.jwt = config.jwt;

    const client = new SignalingClient({
      url: config.url,
      roomId: config.roomId,
      participantId: config.participantId,
      jwt: config.jwt,
    });

    this.handler = (payload: HostCredentialPayload) => this.applyHostCredential(payload);
    client.on('host-credential', this.handler);
    this.client = client;

    void client.connect().catch(() => {
      // Reconnect is handled by SignalingClient backoff; failures fail closed.
    });
  }

  /**
   * Applies a private host credential. Duplicate deliveries of the same
   * generation/handle are suppressed so a reconnect cannot trigger a duplicate
   * host upgrade.
   */
  private applyHostCredential(payload: HostCredentialPayload): void {
    if (!payload || typeof payload.hostToken !== 'string' || typeof payload.resumeHandle !== 'string') {
      return;
    }

    const store = useAppStore.getState();
    // Target-only: the credential is valid only for the authenticated participant.
    if (store.participantId && this.participantId && store.participantId !== this.participantId) {
      return;
    }
    // Stale/duplicate delivery suppression.
    if (this.lastAppliedKey && payload.resumeHandle === store.resumeHandle && payload.hostToken === store.hostToken) {
      return;
    }

    this.lastAppliedKey = `${payload.roomInstanceId ?? ''}|${payload.generation ?? 0}|${payload.resumeHandle}`;

    store.setSessionAuthority({
      hostToken: payload.hostToken,
      hostKey: payload.hostKey ?? null,
      roomInstanceId: payload.roomInstanceId ?? null,
      resumeHandle: payload.resumeHandle,
    });

    HostControlManager.getInstance().setSessionContext({
      roomId: this.roomId ?? '',
      localParticipantId: this.participantId ?? undefined,
      hostToken: payload.hostToken,
      hostKey: payload.hostKey ?? null,
    });

    if (this.participantId) {
      usePresenceStore.getState().setAuthoritativeHost(this.participantId);
    }
    this.deliveryCount++;
  }

  /** Number of distinct credentials applied (test/verification hook). */
  getDeliveryCount(): number {
    return this.deliveryCount;
  }

  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  disconnect(): void {
    if (this.client && this.handler) {
      this.client.off('host-credential', this.handler);
    }
    this.client?.disconnect();
    this.client = null;
    this.handler = null;
    this.roomId = null;
    this.participantId = null;
    this.jwt = null;
    this.lastAppliedKey = null;
    this.deliveryCount = 0;
  }
}
