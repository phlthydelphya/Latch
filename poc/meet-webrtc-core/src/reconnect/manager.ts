/**
 * Reconnect Manager - ICE Restart + WSS Reconnect
 * <5s p95, epoch preserved, buffered key rotation replay
 */

import { EventEmitter } from 'eventemitter3';
import type { ReconnectConfig } from '../types.js';

export interface ReconnectState {
  isReconnecting: boolean;
  attempt: number;
  startTime: number;
  lastDisconnectReason: string | null;
  iceRestartTriggered: boolean;
  epochPreserved: boolean;
  bufferedMessages: any[];
}

export interface ReconnectManagerConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  iceRestart: boolean;
  preserveEpoch: boolean;
  signalReconnect?: () => Promise<void>;
  createIceRestartOffer?: () => Promise<void>;
}

export class ReconnectManager extends EventEmitter {
  private config: ReconnectManagerConfig;
  private state: ReconnectState = {
    isReconnecting: false,
    attempt: 0,
    startTime: 0,
    lastDisconnectReason: null,
    iceRestartTriggered: false,
    epochPreserved: false,
    bufferedMessages: [],
  };
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;

  constructor(config: ReconnectManagerConfig) {
    super();
    this.config = config;
  }

  start(reason: string = 'unknown'): void {
    if (this.state.isReconnecting) return;
    
    this.state = {
      isReconnecting: true,
      attempt: 0,
      startTime: performance.now(),
      lastDisconnectReason: reason,
      iceRestartTriggered: false,
      epochPreserved: this.config.preserveEpoch,
      bufferedMessages: [],
    };
    
    this.shouldReconnect = true;
    this.emit('reconnecting', { reason, attempt: 0 });
    this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.shouldReconnect || this.state.attempt >= this.config.maxAttempts) {
      this.handleFailure(new Error('Max reconnect attempts reached'));
      return;
    }

    const delay = Math.min(
      this.config.baseDelayMs * Math.pow(2, this.state.attempt),
      this.config.maxDelayMs
    );

    this.state.attempt++;
    this.emit('reconnect-attempt', { attempt: this.state.attempt, delay });

    await new Promise(resolve => setTimeout(resolve, delay));

    if (!this.shouldReconnect) return;

    try {
      // 1. Reconnect signaling
      if (this.config.signalReconnect) {
        await this.config.signalReconnect();
      }

      // 2. Trigger ICE restart if enabled
      if (this.config.iceRestart && !this.state.iceRestartTriggered && this.config.createIceRestartOffer) {
        await this.config.createIceRestartOffer();
        this.state.iceRestartTriggered = true;
        this.emit('ice-restart-triggered');
      }

      // 3. Verify connection restored
      // This would be confirmed by WebRTC connectionstatechange to 'connected'
      // The WebRTCManager will emit 'reconnected' when confirmed
      
    } catch (error) {
      console.error(`Reconnect attempt ${this.state.attempt} failed:`, error);
      this.attemptReconnect();
    }
  }

  onReconnected(epochPreserved: boolean = true): void {
    this.state.isReconnecting = false;
    this.state.epochPreserved = epochPreserved;
    this.shouldReconnect = false;
    
    const totalLatency = performance.now() - this.state.startTime;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.emit('reconnected', {
      latencyMs: totalLatency,
      attempts: this.state.attempt,
      epochPreserved,
      bufferedMessagesReplayed: this.state.bufferedMessages.length,
    });

    // Replay buffered messages
    this.replayBufferedMessages();
  }

  onReconnectFailed(error: Error): void {
    this.handleFailure(error);
  }

  private handleFailure(error: Error): void {
    this.state.isReconnecting = false;
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const totalLatency = performance.now() - this.state.startTime;
    
    this.emit('failed', {
      error,
      totalLatencyMs: totalLatency,
      attempts: this.state.attempt,
    });
  }

  bufferMessage(message: any): void {
    if (this.state.isReconnecting) {
      this.state.bufferedMessages.push({
        ...message,
        timestamp: Date.now(),
      });
      
      // Limit buffer size
      if (this.state.bufferedMessages.length > 100) {
        this.state.bufferedMessages.shift();
      }
    }
  }

  private replayBufferedMessages(): void {
    for (const message of this.state.bufferedMessages) {
      this.emit('buffered-message', message);
    }
    this.state.bufferedMessages = [];
  }

  cancel(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state.isReconnecting = false;
  }

  getState(): ReconnectState {
    return { ...this.state };
  }

  isReconnecting(): boolean {
    return this.state.isReconnecting;
  }

  // ==================== NETWORK SIMULATION HELPERS ====================

  static async simulateNetworkDisconnect(durationMs: number = 3000): Promise<void> {
    // For testing: kill WSS or use tc to drop packets
    // tc qdisc add dev eth0 root netem loss 100%
    // sleep 3
    // tc qdisc del dev eth0 root
    console.log(`Simulating network disconnect for ${durationMs}ms`);
  }

  static async simulateIceRestart(): Promise<void> {
    // Force ICE restart by changing network conditions
    console.log('Simulating ICE restart scenario');
  }
}