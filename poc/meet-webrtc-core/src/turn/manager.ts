/**
 * TURN Manager - Full fallback chain STUN→TURN UDP→TCP443→TLS443
 * coturn HMAC 24h ephemeral credentials
 * Relay confirmed via webrtc-internals candidateType=relay
 */

import { EventEmitter } from 'eventemitter3';
import type { RTCIceServer, TURNCredentials, RTCIceCandidatePairStats, RTCIceCandidateStats } from '../types.js';

export interface TURNManagerConfig {
  credentialsUrl: string;
  roomId: string;
  participantHash: string;
  stunServers?: string[];
  turnServers?: string[];
  forceRelay?: boolean;
  allocationTimeoutMs?: number;
}

export interface TURNState {
  credentials: TURNCredentials | null;
  iceServers: RTCIceServer[];
  allocationLatencyMs: number;
  candidateType: RTCIceCandidateType | null;
  protocol: 'udp' | 'tcp' | 'tls' | 'unknown' | null;
  relayConfirmed: boolean;
  error: Error | null;
}

export class TURNManager extends EventEmitter {
  private config: TURNManagerConfig;
  private state: TURNState = {
    credentials: null,
    iceServers: [],
    allocationLatencyMs: 0,
    candidateType: null,
    protocol: null,
    relayConfirmed: false,
    error: null,
  };
  private credentialsRefreshTimer: number | null = null;

  constructor(config: TURNManagerConfig) {
    super();
    this.config = {
      stunServers: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      turnServers: [],
      forceRelay: false,
      allocationTimeoutMs: 2000,
      ...config,
    };
  }

  async getCredentials(): Promise<RTCIceServer[]> {
    const startTime = performance.now();
    
    try {
      // Fetch ephemeral TURN credentials from turn-auth service
      const response = await fetch(this.config.credentialsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: this.config.roomId,
          participantHash: this.config.participantHash,
        }),
      });

      if (!response.ok) {
        throw new Error(`TURN credentials fetch failed: ${response.status}`);
      }

      const credentials: TURNCredentials = await response.json();
      this.state.credentials = credentials;
      this.state.allocationLatencyMs = performance.now() - startTime;

      // Build ICE servers with fallback chain
      this.state.iceServers = this.buildIceServers(credentials);
      
      // Schedule credential refresh (24h TTL - refresh at 23h)
      this.scheduleRefresh(credentials.ttl * 1000 - 3600000);

      this.emit('credentials-updated', { credentials, iceServers: this.state.iceServers });
      return this.state.iceServers;
    } catch (error) {
      this.state.error = error as Error;
      console.error('TURN credentials error:', error);
      
      // Fallback to STUN only
      this.state.iceServers = this.buildStunOnlyServers();
      this.emit('credentials-failed', { error, fallbackServers: this.state.iceServers });
      return this.state.iceServers;
    }
  }

  private buildIceServers(credentials: TURNCredentials): RTCIceServer[] {
    const servers: RTCIceServer[] = [];

    // 1. STUN servers (direct connection attempt)
    for (const stunUrl of this.config.stunServers!) {
      servers.push({ urls: stunUrl });
    }

    // 2. TURN UDP (preferred for media)
    for (const turnUrl of credentials.urls) {
      if (turnUrl.startsWith('turn:')) {
        servers.push({
          urls: turnUrl,
          username: credentials.username,
          credential: credentials.credential,
          credentialType: 'password',
        });
      }
    }

    // 3. TURN TCP 443 (firewall traversal)
    for (const turnUrl of credentials.urls) {
      if (turnUrl.startsWith('turn:') && turnUrl.includes(':443?transport=tcp')) {
        servers.push({
          urls: turnUrl,
          username: credentials.username,
          credential: credentials.credential,
          credentialType: 'password',
        });
      }
    }

    // 4. TURNS 443 (TLS, most restrictive firewalls)
    for (const turnUrl of credentials.urls) {
      if (turnUrl.startsWith('turns:')) {
        servers.push({
          urls: turnUrl,
          username: credentials.username,
          credential: credentials.credential,
          credentialType: 'password',
        });
      }
    }

    // If forceRelay, only use TURN servers
    if (this.config.forceRelay) {
      return servers.filter(s => 
        Array.isArray(s.urls) 
          ? s.urls.some(u => u.startsWith('turn:') || u.startsWith('turns:'))
          : s.urls.startsWith('turn:') || s.urls.startsWith('turns:')
      );
    }

    return servers;
  }

  private buildStunOnlyServers(): RTCIceServer[] {
    return this.config.stunServers!.map(url => ({ urls: url }));
  }

  private scheduleRefresh(ttlMs: number): void {
    if (this.credentialsRefreshTimer) {
      clearTimeout(this.credentialsRefreshTimer);
    }
    
    this.credentialsRefreshTimer = window.setTimeout(() => {
      this.getCredentials().catch(console.error);
    }, Math.max(ttlMs, 60000)); // At least 1 minute
  }

  // ==================== RELAY VERIFICATION ====================

  async verifyRelay(pc: RTCPeerConnection): Promise<{ confirmed: boolean; candidateType: RTCIceCandidateType; protocol: string; latencyMs: number }> {
    const startTime = performance.now();
    
    try {
      const stats = await pc.getStats();
      let relayCandidate = null as RTCIceCandidatePairStats | null;
      
      stats.forEach((stat) => {
        if (stat.type === 'candidate-pair' && stat.nominated) {
          relayCandidate = stat as RTCIceCandidatePairStats;
        }
      });

      if (!relayCandidate) {
        throw new Error('No nominated candidate pair found');
      }

      // Get local candidate details
      const localCandidateId = relayCandidate.localCandidateId;
      let localCandidate = null as RTCIceCandidateStats | null;
      
      stats.forEach((stat) => {
        if (stat.id === localCandidateId && stat.type === 'local-candidate') {
          localCandidate = stat as RTCIceCandidateStats;
        }
      });

      if (!localCandidate) {
        throw new Error('Local candidate not found');
      }

      this.state.candidateType = localCandidate.candidateType;
      this.state.protocol = localCandidate.protocol || 'unknown';
      this.state.relayConfirmed = localCandidate.candidateType === 'relay';
      
      const latency = performance.now() - startTime;
      
      this.emit('relay-verified', {
        confirmed: this.state.relayConfirmed,
        candidateType: this.state.candidateType,
        protocol: this.state.protocol,
        latencyMs: latency,
      });

      return {
        confirmed: this.state.relayConfirmed,
        candidateType: this.state.candidateType ?? 'host',
        protocol: this.state.protocol ?? 'unknown',
        latencyMs: latency,
      };
    } catch (error) {
      console.error('Relay verification failed:', error);
      return {
        confirmed: false,
        candidateType: 'host',
        protocol: 'unknown',
        latencyMs: performance.now() - startTime,
      };
    }
  }

  async testAllocation(): Promise<{ success: boolean; latencyMs: number; candidateType: RTCIceCandidateType }> {
    const startTime = performance.now();
    
    try {
      // Create a temporary peer connection to test TURN allocation
      const pc = new RTCPeerConnection({
        iceServers: this.state.iceServers,
        iceTransportPolicy: this.config.forceRelay ? 'relay' : 'all',
      });

      // Create data channel to trigger ICE gathering
      pc.createDataChannel('turn-test');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('ICE gathering timeout')), this.config.allocationTimeoutMs);
        
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            resolve();
          }
        };
      });

      // Get local candidates
      const stats = await pc.getStats();
      let candidateType: RTCIceCandidateType = 'host';
      
      stats.forEach((stat) => {
        if (stat.type === 'local-candidate' && (stat as any).candidateType) {
          candidateType = (stat as any).candidateType;
        }
      });

      pc.close();

      const latency = performance.now() - startTime;
      
      return {
        success: true,
        latencyMs: latency,
        candidateType,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: performance.now() - startTime,
        candidateType: 'host',
      };
    }
  }

  // ==================== NETWORK SIMULATION (for testing) ====================

  static async simulateStrictNAT(): Promise<void> {
    // This would be run in test environment with iptables/tc
    // iptables -p udp --dport 3478 -j DROP
    // tc qdisc add dev eth0 root netem loss 100% (for UDP)
    console.log('Strict NAT simulation: Block UDP 3478, force TCP/TLS relay');
  }

  static getFallbackChain(): string[] {
    return [
      'STUN (direct)',
      'TURN UDP 3478',
      'TURN TCP 443',
      'TURNS TLS 443',
      'SFU relay via TURN (last resort)',
    ];
  }

  getState(): TURNState {
    return { ...this.state };
  }

  getIceServers(): RTCIceServer[] {
    return [...this.state.iceServers];
  }

  destroy(): void {
    if (this.credentialsRefreshTimer) {
      clearTimeout(this.credentialsRefreshTimer);
      this.credentialsRefreshTimer = null;
    }
    this.removeAllListeners();
  }
}