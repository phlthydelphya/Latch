/**
 * Milestone M4A: Authoritative Session Control Comprehensive Test Suite
 *
 * Test Coverage:
 * - M4A-SEC-01: Moderation directive rejected from non-host attendee (zero disruption)
 * - M4A-SEC-02: Non-host transferHost rejected; host remains unchanged
 * - M4A-SEC-03: Expired host token rejected by verifier
 * - M4A-SEC-04: Audience mismatch (Room A token in Room B) rejected
 * - M4A-SEC-05: ECDSA P-256 signature verification fails when JWT payload is tampered
 * - M4A-SEC-09: Client self-assertion of isHost rejected by presence store
 * - M4A-SEC-10: Host UI and controls persist across multiple peer joins
 * - M4A-UX-05: Display name validation blocks entry on empty/whitespace with exact error message
 * - M4A-UX-06: Waiting room default policy and admission lifecycle
 * - M4A-UX-07: Leave confirmation governance (participant dialog, host departure, final participant direct exit)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventEmitter } from 'events';
import { HostControlManager } from '../src/host/hostControlManager';
import { HostTokenVerifier } from '../src/host/hostTokenVerifier';
import { useHostControlStore } from '../src/host/hostControlStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { useAppStore } from '../src/store/appStore';
import { HOST_CONTROL_TOPIC, HostDirectiveMessage } from '../src/host/types';
import { PreJoinPage } from '../src/pages/PreJoinPage';
import { ControlBar } from '../src/components/ControlBar';
import { LeaveConfirmationModal } from '../src/components/LeaveConfirmationModal';
import { VideoGrid } from '../src/components/VideoGrid';
import { RosterDrawer } from '../src/components/RosterDrawer';
import { WaitingRoomBanner } from '../src/components/host/WaitingRoomBanner';
import { PresenceAdapter } from '../src/presence/presenceAdapter';

class MockRoom extends EventEmitter {
  localParticipant: any = {
    identity: 'local-user',
    name: 'Local User',
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    setMicrophoneEnabled: vi.fn(),
    publishData: vi.fn().mockResolvedValue(undefined),
  };
  remoteParticipants: Map<string, any> = new Map();
}

function createUnsignedMockToken(sub: string, room: string, expOffsetSec: number = 3600): string {
  const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(
    JSON.stringify({
      sub,
      room,
      aud: room,
      role: 'host',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    })
  ).replace(/=/g, '');
  const signature = btoa('mock-signature-bytes').replace(/=/g, '');
  return `${header}.${payload}.${signature}`;
}

describe('M4A: Authoritative Session Control', () => {
  let mockRoom: MockRoom;
  let manager: HostControlManager;

  beforeEach(() => {
    useHostControlStore.getState().reset();
    usePresenceStore.getState().resetPresence();
    useAppStore.setState(useAppStore.getInitialState());

    mockRoom = new MockRoom();
    manager = HostControlManager.getInstance();
    manager.attach(mockRoom as any);

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'cam-1', kind: 'videoinput', label: 'Integrated Camera', groupId: 'g1' },
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Default Microphone', groupId: 'g1' },
        ]),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [
            { kind: 'video', stop: vi.fn(), enabled: true },
            { kind: 'audio', stop: vi.fn(), enabled: true },
          ],
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      configurable: true,
      writable: true,
    });

    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;
  });

  afterEach(() => {
    manager.detach();
    vi.restoreAllMocks();
  });

  describe('Security Validation (M4A-SEC)', () => {
    it('M4A-SEC-01: Attendee sends forged mute-participant with self-asserted host claim -> rejected, zero audio disruption', () => {
      useAppStore.setState({
        roomId: 'sec-room-1',
        participantId: 'local-user',
        isConnected: true,
        localParticipant: {
          id: 'local-user',
          name: 'Local User',
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isLocal: true,
          isSpeaking: false,
        },
      });

      // Established authoritative host is 'alice-host'
      usePresenceStore.setState({
        localParticipantId: 'local-user',
        hostId: 'alice-host',
      });

      manager.setSessionContext({
        roomId: 'sec-room-1',
        localParticipantId: 'local-user',
      });

      // Mallory attempts to send mute-participant with self-asserted mock token
      const forgedToken = createUnsignedMockToken('mallory-attacker', 'sec-room-1');
      const payload = new TextEncoder().encode(
        JSON.stringify({
          type: 'host-directive',
          action: 'mute-participant',
          targetParticipantId: 'local-user',
          timestamp: Date.now(),
          hostToken: forgedToken,
        })
      );

      mockRoom.emit(
        'dataReceived',
        payload,
        { identity: 'mallory-attacker' },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Audio should remain enabled; zero disruption
      expect(useAppStore.getState().localParticipant?.audioEnabled).toBe(true);
      expect(mockRoom.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled();
    });

    it('M4A-SEC-02: Non-host attempts transferHost -> rejected, host remains unchanged', async () => {
      useAppStore.setState({
        roomId: 'sec-room-2',
        participantId: 'regular-user',
        isConnected: true,
      });

      usePresenceStore.setState({
        localParticipantId: 'regular-user',
        hostId: 'authoritative-host-alice',
      });

      manager.setSessionContext({
        roomId: 'sec-room-2',
        localParticipantId: 'regular-user',
        hostToken: null, // No host token
      });

      await expect(manager.transferHost('bob-peer')).rejects.toThrow('Only the meeting host can transfer host authority');
      expect(usePresenceStore.getState().hostId).toBe('authoritative-host-alice');
      expect(mockRoom.localParticipant.publishData).not.toHaveBeenCalled();
    });

    it('M4A-SEC-03: Attacker replays expired host token -> verifier rejects token', () => {
      const expiredToken = createUnsignedMockToken('alice-host', 'room-exp', -100);
      const directive: HostDirectiveMessage = {
        action: 'lock-room',
        isLocked: true,
        hostToken: expiredToken,
        timestamp: Date.now(),
      };

      const result = HostTokenVerifier.verifyClaimsSync(directive, 'room-exp', 'alice-host');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Host token has expired');
    });

    it('M4A-SEC-04: Attacker uses valid host token from Room A in Room B -> audience mismatch rejected', () => {
      const roomAToken = createUnsignedMockToken('alice-host', 'room-alpha');
      const directive: HostDirectiveMessage = {
        action: 'lock-room',
        isLocked: true,
        hostToken: roomAToken,
        timestamp: Date.now(),
      };

      const result = HostTokenVerifier.verifyClaimsSync(directive, 'room-beta', 'alice-host');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Room audience mismatch');
    });

    it('M4A-SEC-05: Impostor participant modifies sub in JWT without private key -> ECDSA P-256 signature verification fails', async () => {
      // Generate genuine ECDSA P-256 keypair
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );

      const exportedPub = await crypto.subtle.exportKey('spki', keyPair.publicKey);
      const pubHex = Array.from(new Uint8Array(exportedPub), (b) => b.toString(16).padStart(2, '0')).join('');

      const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).replace(/=/g, '');
      const validPayload = btoa(
        JSON.stringify({
          sub: 'alice-host',
          room: 'crypto-room',
          aud: 'crypto-room',
          role: 'host',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).replace(/=/g, '');

      // Sign legitimate header.payload
      const enc = new TextEncoder();
      const legitimateSigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        keyPair.privateKey,
        enc.encode(`${header}.${validPayload}`)
      );
      const legitimateSigBase64 = btoa(String.fromCharCode(...new Uint8Array(legitimateSigBuffer))).replace(/=/g, '');

      const validToken = `${header}.${validPayload}.${legitimateSigBase64}`;
      const validDirective: HostDirectiveMessage = {
        action: 'lock-room',
        isLocked: true,
        hostToken: validToken,
        timestamp: Date.now(),
      };

      const validResult = await HostTokenVerifier.verifyDirective(
        validDirective,
        'crypto-room',
        'alice-host',
        pubHex
      );
      expect(validResult.valid).toBe(true);

      // Now attacker attempts to modify subject in payload to 'impostor'
      const tamperedPayload = btoa(
        JSON.stringify({
          sub: 'impostor',
          room: 'crypto-room',
          aud: 'crypto-room',
          role: 'host',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).replace(/=/g, '');

      const tamperedToken = `${header}.${tamperedPayload}.${legitimateSigBase64}`;
      const tamperedDirective: HostDirectiveMessage = {
        action: 'lock-room',
        isLocked: true,
        hostToken: tamperedToken,
        timestamp: Date.now(),
      };

      const tamperedResult = await HostTokenVerifier.verifyDirective(
        tamperedDirective,
        'crypto-room',
        'impostor',
        pubHex
      );
      expect(tamperedResult.valid).toBe(false);
      expect(tamperedResult.error).toBe('Cryptographic signature verification failed');
    });

    it('M4A-SEC-09: Client assertion of creator/host role is rejected when hostId is not set', () => {
      // Ensure hostId is null
      usePresenceStore.setState({ hostId: null });

      // Remote attendee joins claiming isHost: true
      usePresenceStore.getState().upsertParticipant({
        id: 'attacker-1',
        name: 'Attacker',
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isSpeaking: false,
        connectionQuality: 'good',
        isHandRaised: false,
        isHost: true,
        joinedAt: Date.now(),
      });

      // Presence store must NEVER adopt attacker's isHost claim
      expect(usePresenceStore.getState().hostId).toBeNull();
      expect(usePresenceStore.getState().participants.get('attacker-1')?.isHost).toBe(false);
    });

    it('M4A-SEC-10: Multiple participants joining an existing room preserves host UI and controls permanently', () => {
      // Local participant is established authoritative host
      usePresenceStore.setState({
        localParticipantId: 'local-host-id',
        hostId: 'local-host-id',
      });

      const getIsLocalHost = () => {
        const state = usePresenceStore.getState();
        return state.hostId !== null && state.hostId === state.localParticipantId;
      };

      expect(getIsLocalHost()).toBe(true);

      // 10 remote participants join, some claiming isHost: true
      for (let i = 1; i <= 10; i++) {
        usePresenceStore.getState().upsertParticipant({
          id: `peer-${i}`,
          name: `Peer ${i}`,
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isSpeaking: false,
          connectionQuality: 'good',
          isHandRaised: false,
          isHost: i % 2 === 0, // Even peers attempt to self-assert host
          joinedAt: Date.now() + i,
        });

        // Host authority must never be displaced
        expect(usePresenceStore.getState().hostId).toBe('local-host-id');
        expect(getIsLocalHost()).toBe(true);
      }

      // Check all remote participants are properly demoted
      for (let i = 1; i <= 10; i++) {
        expect(usePresenceStore.getState().participants.get(`peer-${i}`)?.isHost).toBe(false);
      }
    });
  });

  describe('UX Governance Validation (M4A-UX)', () => {
    it('M4A-UX-05: User provides empty or whitespace-only display name -> Join action disabled and Display name is required displayed', async () => {
      render(
        <MemoryRouter initialEntries={['/r/test-meeting-room']}>
          <Routes>
            <Route path="/r/:roomId" element={<PreJoinPage />} />
          </Routes>
        </MemoryRouter>
      );

      const nameInput = screen.getByLabelText(/your name/i);
      const joinButton = screen.getByRole('button', { name: /join meeting/i });

      // Initially empty -> button disabled
      expect((joinButton as HTMLButtonElement).disabled).toBe(true);

      // Enter whitespace only
      fireEvent.change(nameInput, { target: { value: '    ' } });
      expect((joinButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('Display name is required.')).not.toBeNull();

      // Clear input
      fireEvent.change(nameInput, { target: { value: '' } });
      expect((joinButton as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText('Display name is required.')).not.toBeNull();

      // Enter valid name
      fireEvent.change(nameInput, { target: { value: 'Alice' } });
      expect((joinButton as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByText('Display name is required.')).toBeNull();
    });

    it('M4A-UX-06: Waiting room defaults to enabled and properly queues knocking attendees', () => {
      const state = useHostControlStore.getState();
      expect(state.isWaitingRoomEnabled).toBe(true);
      expect(state.waitingQueue).toEqual([]);

      // Knocking guest arrives
      useHostControlStore.getState().addWaitingParticipant({
        participantId: 'guest-charlie',
        name: 'Charlie',
        timestamp: Date.now(),
      });

      expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);
      expect(useHostControlStore.getState().waitingQueue[0].name).toBe('Charlie');

      // Host admits guest
      useHostControlStore.getState().removeWaitingParticipant('guest-charlie');
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);
    });

    it('M4A-UX-07: Leave confirmation modal renders correctly for participant and host', () => {
      const mockLeave = vi.fn();
      const mockTransferAndLeave = vi.fn();
      const mockClose = vi.fn();

      // 1. Regular participant flow
      const { rerender } = render(
        <LeaveConfirmationModal
          isOpen={true}
          isHost={false}
          onClose={mockClose}
          onConfirmLeave={mockLeave}
          onTransferAndLeave={mockTransferAndLeave}
        />
      );

      expect(screen.getByText('Leave Meeting?')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Leave Meeting' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Leave Meeting' }));
      expect(mockLeave).toHaveBeenCalledTimes(1);

      // 2. Host departure flow with other participants
      usePresenceStore.setState({
        localParticipantId: 'host-1',
        hostId: 'host-1',
        participants: new Map([
          ['host-1', { id: 'host-1', name: 'Host', isLocal: true, isHost: true, audioEnabled: true, videoEnabled: true, screenSharing: false, isSpeaking: false, connectionQuality: 'good', isHandRaised: false, joinedAt: 1 }],
          ['peer-2', { id: 'peer-2', name: 'Peer Bob', isLocal: false, isHost: false, audioEnabled: true, videoEnabled: true, screenSharing: false, isSpeaking: false, connectionQuality: 'good', isHandRaised: false, joinedAt: 2 }],
        ]),
      });

      rerender(
        <LeaveConfirmationModal
          isOpen={true}
          isHost={true}
          onClose={mockClose}
          onConfirmLeave={mockLeave}
          onTransferAndLeave={mockTransferAndLeave}
        />
      );

      expect(screen.getByText('Host Departure')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Transfer & Leave' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Leave' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Transfer & Leave' }));
      expect(mockTransferAndLeave).toHaveBeenCalledWith('peer-2');
    });

    it('M4A-UX-07b: Host departure as final participant leaves directly without modal', () => {
      const mockOnLeave = vi.fn();

      useAppStore.setState({
        roomId: 'room-final-exit',
        participantId: 'lone-host',
        isConnected: true,
      });

      usePresenceStore.setState({
        localParticipantId: 'lone-host',
        hostId: 'lone-host',
        participants: new Map([
          ['lone-host', { id: 'lone-host', name: 'Lone Host', isLocal: true, isHost: true, audioEnabled: true, videoEnabled: true, screenSharing: false, isSpeaking: false, connectionQuality: 'good', isHandRaised: false, joinedAt: 1 }],
        ]),
      });

      render(<ControlBar onLeave={mockOnLeave} />);

      const leaveButton = screen.getByRole('button', { name: /leave meeting/i });
      fireEvent.click(leaveButton);

      // Because host is the sole participant, exit must be direct without modal
      expect(mockOnLeave).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Host Departure')).toBeNull();
    });

    it('M4A-UX-08: Waiting Room Admission Enforcement (Lobby hold, roster/grid/counter isolation, knock, admit flow)', async () => {
      // 1. Host creates room with waiting room enabled
      useAppStore.setState({
        roomId: 'room-waiting-enforce',
        participantId: 'host-alice',
        isConnected: true,
      });

      usePresenceStore.setState({
        localParticipantId: 'host-alice',
        hostId: 'host-alice',
        participants: new Map([
          [
            'host-alice',
            {
              id: 'host-alice',
              name: 'Alice (Host)',
              isLocal: true,
              isHost: true,
              audioEnabled: true,
              videoEnabled: true,
              screenSharing: false,
              isSpeaking: false,
              connectionQuality: 'good',
              isHandRaised: false,
              joinedAt: 1,
            },
          ],
        ]),
        isRosterOpen: true,
      });

      useHostControlStore.setState({
        isWaitingRoomEnabled: true,
        waitingQueue: [],
        isWaitingInLobby: false,
      });

      // 2. Guest (Bob) joins
      // On Guest side: Guest enters with isWaitingInLobby = true
      // On Room side: Guest connects to WebRTC and sends knock
      const guestIdentity = 'guest-bob';
      const guestName = 'Bob';

      // Guest simulates lobby holding state
      useHostControlStore.getState().setIsWaitingInLobby(true);
      expect(useHostControlStore.getState().isWaitingInLobby).toBe(true);

      // Guest presence is received from signaling/LiveKit
      usePresenceStore.getState().upsertParticipant({
        id: guestIdentity,
        name: guestName,
        isLocal: false,
        audioEnabled: true,
        videoEnabled: true,
        screenSharing: false,
        isSpeaking: false,
        connectionQuality: 'good',
        isHandRaised: false,
        isHost: false,
        joinedAt: 2,
      });

      // Guest knocks, adding to waitingQueue on host side
      useHostControlStore.getState().addWaitingParticipant({
        participantId: guestIdentity,
        name: guestName,
        timestamp: Date.now(),
      });

      // 3. Verify Before Host Admission:
      // - Guest remains in lobby
      expect(useHostControlStore.getState().isWaitingInLobby).toBe(true);

      // - Host receives admission request in waitingQueue
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(1);
      expect(useHostControlStore.getState().waitingQueue[0].name).toBe('Bob');

      // - Render WaitingRoomBanner: verify host receives admission request
      const { unmount: unmountBanner } = render(<WaitingRoomBanner />);
      expect(screen.getByText('Bob is waiting to join')).not.toBeNull();
      unmountBanner();

      // - Guest not rendered in video grid
      const { unmount: unmountGrid } = render(
        <VideoGrid
          localStream={null}
          cameraStreams={new Map()}
          screenStreams={new Map()}
          localVideoEnabled={true}
          localAudioEnabled={true}
          screenSharing={false}
        />
      );
      // Only host's tile is rendered, Bob's tile is NOT rendered
      expect(screen.queryByText('Bob')).toBeNull();
      unmountGrid();

      // - Guest not counted as active participant in ControlBar
      const { unmount: unmountControlBar } = render(<ControlBar />);
      expect(screen.getByText('Participants (1)')).not.toBeNull();
      unmountControlBar();

      // - Guest not visible in active roster
      const { container: rosterContainer, unmount: unmountRoster } = render(<RosterDrawer />);
      // Header badge shows exactly 1 active participant
      const badge = rosterContainer.querySelector('h2 + span');
      expect(badge?.textContent).toBe('1');
      unmountRoster();

      // 4. Host admits guest
      await manager.admitParticipant(guestIdentity);

      // Verify guest is removed from waitingQueue
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);

      // Guest receives admission directive and exits lobby
      useHostControlStore.getState().setIsWaitingInLobby(false);
      expect(useHostControlStore.getState().isWaitingInLobby).toBe(false);

      // 5. Verify After Host Admission:
      // - Guest appears in active roster
      const { container: rosterContainerAfter, unmount: unmountRosterAfter } = render(<RosterDrawer />);
      const badgeAfter = rosterContainerAfter.querySelector('h2 + span');
      expect(badgeAfter?.textContent).toBe('2');
      expect(screen.getByText('Bob')).not.toBeNull();
      unmountRosterAfter();

      // - Guest counted as active participant in ControlBar
      const { unmount: unmountControlBarAfter } = render(<ControlBar />);
      expect(screen.getByText('Participants (2)')).not.toBeNull();
      unmountControlBarAfter();

      // - Guest appears in video grid
      const { unmount: unmountGridAfter } = render(
        <VideoGrid
          localStream={null}
          cameraStreams={new Map()}
          screenStreams={new Map()}
          localVideoEnabled={true}
          localAudioEnabled={true}
          screenSharing={false}
        />
      );
      expect(screen.getByText('Bob')).not.toBeNull();
      unmountGridAfter();
    });

    it('M4A-UX-09: LiveKit ParticipantConnected event automatically queues unadmitted guests into waitingQueue on host', async () => {
      const hostIdentity = 'host-user-1';
      const guestIdentity = 'guest-charlie';
      const guestName = 'Charlie';

      // Setup host state
      usePresenceStore.setState({
        localParticipantId: hostIdentity,
        hostId: hostIdentity,
        participants: new Map([
          [
            hostIdentity,
            {
              id: hostIdentity,
              name: 'Host Alice',
              isLocal: true,
              audioEnabled: true,
              videoEnabled: true,
              screenSharing: false,
              isSpeaking: false,
              connectionQuality: 'good',
              isHandRaised: false,
              isHost: true,
              joinedAt: 1,
            },
          ],
        ]),
        toastQueue: [],
      });

      useHostControlStore.setState({
        isWaitingRoomEnabled: true,
        waitingQueue: [],
        admittedParticipants: new Set<string>(),
        isWaitingInLobby: false,
      });

      // Mock Room and PresenceAdapter
      const listeners: Record<string, Function[]> = {};
      const mockRoom: any = {
        localParticipant: {
          identity: hostIdentity,
          name: 'Host Alice',
          metadata: JSON.stringify({ role: 'host' }),
          isMicrophoneEnabled: true,
          isCameraEnabled: true,
          isScreenShareEnabled: false,
          isSpeaking: false,
          connectionQuality: 0,
        },
        remoteParticipants: new Map(),
        on: vi.fn((event: string, cb: Function) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
        }),
        off: vi.fn(),
      };

      const adapter = new PresenceAdapter(mockRoom);

      // Simulate LiveKit emitting ParticipantConnected for Charlie
      const mockGuestParticipant: any = {
        identity: guestIdentity,
        name: guestName,
        metadata: JSON.stringify({ role: 'attendee' }),
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        isSpeaking: false,
        connectionQuality: 0,
      };

      const connectedCbs = listeners['participantConnected'] || [];
      for (const cb of connectedCbs) {
        cb(mockGuestParticipant);
      }

      // 1. Host has queued Charlie in waitingQueue
      const waiting = useHostControlStore.getState().waitingQueue;
      expect(waiting).toHaveLength(1);
      expect(waiting[0].participantId).toBe(guestIdentity);
      expect(waiting[0].name).toBe(guestName);

      // 2. Host received "Charlie is waiting to join" toast (not "Charlie joined")
      const toasts = usePresenceStore.getState().toastQueue;
      const waitingToast = toasts.find((t) => t.title === 'Waiting Room' && t.message?.includes('Charlie is waiting to join'));
      expect(waitingToast).toBeDefined();
      const regularJoinToast = toasts.find((t) => t.title === 'Charlie joined');
      expect(regularJoinToast).toBeUndefined();

      // 3. WaitingRoomBanner shows Charlie waiting
      const { unmount: unmountBanner } = render(<WaitingRoomBanner />);
      expect(screen.getByText('Charlie is waiting to join')).not.toBeNull();
      unmountBanner();

      // 4. Host admits Charlie
      await HostControlManager.getInstance().admitParticipant(guestIdentity);

      // 5. Charlie is now in admittedParticipants and removed from waitingQueue
      expect(useHostControlStore.getState().waitingQueue).toHaveLength(0);
      expect(useHostControlStore.getState().admittedParticipants.has(guestIdentity)).toBe(true);

      // 6. Host received "Charlie admitted" toast
      const admittedToast = usePresenceStore.getState().toastQueue.find((t) => t.title?.includes('Charlie admitted'));
      expect(admittedToast).toBeDefined();

      adapter.detach();
    });

    it('M4A-UX-10: Host directive waiting-room-admit received over DataChannel transitions guest out of lobby and publishes media', async () => {
      const guestIdentity = 'guest-bob';
      const hostIdentity = 'host-alice';
      const roomId = 'room-admit-trigger';

      // Setup guest local state: guest is held in lobby
      useAppStore.setState({
        roomId,
        participantId: guestIdentity,
        isConnected: true,
        localParticipant: {
          id: guestIdentity,
          name: 'Bob',
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isLocal: true,
          isSpeaking: false,
        },
      });

      usePresenceStore.setState({
        localParticipantId: guestIdentity,
        hostId: hostIdentity,
        participants: new Map([
          [
            guestIdentity,
            {
              id: guestIdentity,
              name: 'Bob',
              isLocal: true,
              audioEnabled: true,
              videoEnabled: true,
              screenSharing: false,
              isSpeaking: false,
              connectionQuality: 'good',
              isHandRaised: false,
              joinedAt: 1,
            },
          ],
        ]),
      });

      useHostControlStore.setState({
        isWaitingRoomEnabled: true,
        isWaitingInLobby: true,
      });

      const guestMockRoom = new MockRoom();
      guestMockRoom.localParticipant = {
        identity: guestIdentity,
        name: 'Bob',
        setCameraEnabled: vi.fn().mockResolvedValue(undefined),
        setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined),
        publishData: vi.fn().mockResolvedValue(undefined),
      };

      const guestManager = HostControlManager.getInstance();
      guestManager.setSessionContext({
        roomId,
        localParticipantId: guestIdentity,
      });
      guestManager.attach(guestMockRoom as any);

      // Verify guest is currently in lobby
      expect(useHostControlStore.getState().isWaitingInLobby).toBe(true);

      // Host sends waiting-room-admit targeting guest-bob
      const hostToken = createUnsignedMockToken(hostIdentity, roomId);
      const admitPayload = new TextEncoder().encode(
        JSON.stringify({
          type: 'host-directive',
          action: 'waiting-room-admit',
          targetParticipantId: guestIdentity,
          senderId: hostIdentity,
          hostToken,
          timestamp: Date.now(),
        })
      );

      guestMockRoom.emit(
        'dataReceived',
        admitPayload,
        { identity: hostIdentity },
        undefined,
        HOST_CONTROL_TOPIC
      );

      // Verify guest is no longer in lobby
      expect(useHostControlStore.getState().isWaitingInLobby).toBe(false);
      expect(useHostControlStore.getState().admittedParticipants.has(guestIdentity)).toBe(true);

      // Verify admission toast was pushed
      const toasts = usePresenceStore.getState().toastQueue;
      const admitToast = toasts.find((t) => t.title === 'Admitted');
      expect(admitToast).toBeDefined();
      expect(admitToast?.message).toContain('host admitted you');

      // Verify camera and microphone were enabled post-admission
      expect(guestMockRoom.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
      expect(guestMockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);

      guestManager.detach();
    });
  });
});
