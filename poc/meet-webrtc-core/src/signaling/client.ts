/**
 * Signaling Client - WSS + JSON + Redis pub/sub
 * Stateless, JWT authenticated, room-scoped channels
 */

import { EventEmitter } from 'eventemitter3';
import type { SignalingMessage, RTCSessionDescriptionInit, RTCIceCandidateInit } from '../types.js';

export interface SignalingConfig {
  url: string;
  roomId: string;
  participantId: string;
  jwt: string;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export interface SignalingMessageHandler {
  (message: SignalingMessage): void;
}

export class SignalingClient extends EventEmitter {
  private config: SignalingConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private messageQueue: SignalingMessage[] = [];
  private isConnecting = false;
  private shouldReconnect = true;

  constructor(config: SignalingConfig) {
    super();
    this.config = {
      reconnectAttempts: 10,
      reconnectDelayMs: 1000,
      heartbeatIntervalMs: 5000,
      ...config,
    };
  }

  getConnectionUrl(): string {
    let cleanUrl = (this.config.url || '').trim();
    while (cleanUrl.endsWith('?') || cleanUrl.endsWith('&')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    const separator = cleanUrl.includes('?') ? '&' : '?';
    const room = encodeURIComponent((this.config.roomId ?? '').trim());
    return `${cleanUrl}${separator}v=1&room=${room}`;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getConnectionUrl();
        this.ws = new WebSocket(wsUrl, ['meet-token', this.config.jwt || '']);

                this.ws.onopen = () => {
          console.log('Signaling connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushQueue();
          this.emit('connected');
          resolve();
        };

                this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          console.log('Signaling disconnected:', event.code, event.reason);
          this.isConnecting = false;
          this.stopHeartbeat();
          this.emit('disconnected', { code: event.code, reason: event.reason });
          
          if (this.shouldReconnect && !event.wasClean) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('Signaling error:', error);
          this.emit('error', error);
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(error);
          }
        };
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const message: SignalingMessage = typeof data === 'string' 
        ? JSON.parse(data) 
        : JSON.parse(new TextDecoder().decode(data));
      
      // Validate message structure
      if (!message.type || !message.payload || !message.roomId) {
        console.warn('Invalid signaling message:', message);
        return;
      }

      // Emit typed events — commit is handled via DataChannel, not signaling
      switch (message.type) {
        case 'offer':
          this.emit('offer', message.payload as RTCSessionDescriptionInit);
          break;
        case 'answer':
          this.emit('answer', message.payload as RTCSessionDescriptionInit);
          break;
        case 'ice-candidate':
          this.emit('ice-candidate', message.payload as RTCIceCandidateInit);
          break;
        case 'join':
          this.emit('join', message.payload);
          break;
        case 'hpke-pubkey':
          this.emit('hpke-pubkey', message.payload);
          break;
        case 'leave':
          this.emit('leave', message.payload);
          break;
        case 'mute':
          this.emit('mute', message.payload);
          break;
        case 'speaking':
          this.emit('speaking', message.payload);
          break;
        case 'welcome':
          this.emit('welcome', message.payload);
          break;
        case 'session-update':
          this.emit('session-update', message.payload);
          break;
        // SEC-02C: server-delivered private host credential for the transfer
        // target only. Never logged; applied by the control-channel manager.
        case 'host-credential':
          this.emit('host-credential', message.payload);
          break;
        default:
          console.warn('Unknown signaling message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse signaling message:', error);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    const delay = Math.min(
      this.config.reconnectDelayMs! * Math.pow(2, this.reconnectAttempts),
      30000
    );
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      
      if (this.reconnectAttempts > this.config.reconnectAttempts!) {
        console.error('Max reconnect attempts reached');
        this.emit('reconnect-failed');
        return;
      }
      
      console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
      this.connect().catch(() => {});
    }, delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', payload: {}, roomId: this.config.roomId, participantId: this.config.participantId, timestamp: Date.now() });
      }
    }, this.config.heartbeatIntervalMs!);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.sendRaw(message);
    }
  }

  send(message: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendRaw(message);
    } else {
      this.messageQueue.push(message);
    }
  }

  private sendRaw(message: SignalingMessage): void {
    this.ws!.send(JSON.stringify(message));
  }

  sendOffer(offer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'offer',
      payload: offer,
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  sendAnswer(answer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'answer',
      payload: answer,
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  sendIceCandidate(candidate: RTCIceCandidateInit): void {
    this.send({
      type: 'ice-candidate',
      payload: candidate,
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  sendMute(mute: { audio?: boolean; video?: boolean }): void {
    this.send({
      type: 'mute',
      payload: mute,
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  sendSpeaking(speaking: boolean): void {
    this.send({
      type: 'speaking',
      payload: { speaking },
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  /** Publish our HPKE public key to peers during join (requirement 2). */
  publishHPKEPublicKey(hpkePublicKeyB64: string): void {
    this.send({
      type: 'hpke-pubkey' as any,
      payload: {
        participantId: this.config.participantId,
        hpkePublicKey: hpkePublicKeyB64,
      },
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  /** Welcome is HPKE-encrypted to the joiner's public key — ciphertext only, no epoch secret plaintext. */
  sendWelcome(welcome: Uint8Array, epoch: number): void {
    this.send({
      type: 'welcome',
      payload: {
        epoch,
        welcome: Array.from(welcome),
      },
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  sendSessionUpdate(iceUfrag: string, icePwd: string): void {
    this.send({
      type: 'session-update',
      payload: { iceUfrag, icePwd },
      roomId: this.config.roomId,
      participantId: this.config.participantId,
      timestamp: Date.now(),
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    
    this.messageQueue = [];
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}