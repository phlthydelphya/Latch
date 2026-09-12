/**
 * REL-01 — Frontend/Backend Session Authority Contract Alignment
 *
 * Regression matrix REG-01..REG-09. The activated SEC-02B/SEC-02C backend
 * contract is authoritative: privileged requests must carry the private session
 * capability, host-operation proof, and one-use resume handle; failures fail
 * closed and are never downgraded to a guest session; credentials are delivered
 * only to the target over the control channel.
 *
 * No test asserts on raw credential values in logs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../src/store/appStore';
import { usePresenceStore } from '../src/presence/presenceStore';
import { createRoom, fetchToken } from '../src/auth/token';
import { HostControlManager } from '../src/host/hostControlManager';
import { ControlChannelManager } from '../src/signaling/controlChannel';
import { HOST_CONTROL_TOPIC } from '../src/host/types';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function seedHostSession(roomId: string, participantId: string) {
  useAppStore.setState({
    roomId,
    participantId,
    jwt: 'access-token',
    livekitToken: 'livekit-token',
    sessionToken: 'session-cap',
    resumeHandle: 'resume-handle',
    roomInstanceId: 'rinst-1',
    hostToken: 'host-proof',
    hostKey: 'host-key',
  });
}

const hostBootstrap = (roomId: string) => ({
  token: 'access-token',
  livekitToken: 'livekit-token',
  participantId: 'p-host',
  roomId,
  role: 'host',
  hostToken: 'host-proof',
  hostKey: 'host-key',
  sessionToken: 'session-cap',
  resumeHandle: 'resume-handle',
  roomInstanceId: 'rinst-1',
  sfuUrl: 'ws://sfu',
});

let fetchMock: ReturnType<typeof vi.fn>;

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => this.onopen && this.onopen(), 0);
  }

  send() {
    // outbound signaling frames are not asserted here
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

beforeEach(() => {
  fetchMock = vi.fn();
  (globalThis as any).fetch = fetchMock;
  (globalThis as any).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  useAppStore.getState().clearRoom();
  ControlChannelManager.getInstance().disconnect();
});

afterEach(() => {
  ControlChannelManager.getInstance().disconnect();
  useAppStore.getState().clearRoom();
  vi.restoreAllMocks();
});

describe('REL-01 session authority contract', () => {
  it('REG-01 fresh host creation hydrates the private authority state without fallback', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(hostBootstrap('room1')));

    const res = await createRoom('Host', 'room1');

    expect(res.role).toBe('host');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('/room/create');

    const s = useAppStore.getState();
    expect(s.sessionToken).toBe('session-cap');
    expect(s.resumeHandle).toBe('resume-handle');
    expect(s.roomInstanceId).toBe('rinst-1');
    expect(s.hostToken).toBe('host-proof');
    expect(init.body).toContain('room1');
  });

  it('REG-01b room creation failure fails closed (no guest fallback)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'room_exists' }, 409));

    await expect(createRoom('Host', 'room1')).rejects.toThrow(/409/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().sessionToken).toBeNull();
  });

  it('REG-02 fresh guest join sends no privileged headers and receives a participant session', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        token: 'guest-access',
        livekitToken: 'guest-livekit',
        participantId: 'p-guest',
        roomId: 'room2',
        role: 'participant',
        sessionToken: 'guest-sc',
        sfuUrl: 'ws://sfu',
      })
    );

    await fetchToken('room2', 'Guest');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-Session-Capability']).toBeUndefined();
    expect(headers['X-Host-Proof']).toBeUndefined();
    expect(headers['X-Resume-Handle']).toBeUndefined();

    const s = useAppStore.getState();
    expect(s.sessionToken).toBe('guest-sc');
    expect(s.hostToken).toBeNull();
    expect(s.resumeHandle).toBeNull();
  });

  it('REG-03 host transfer sends the private contract and drops local authority', async () => {
    seedHostSession('room3', 'p-host');
    usePresenceStore.getState().setAuthoritativeHost('p-host');

    const publishData = vi.fn().mockResolvedValue(undefined);
    const manager = HostControlManager.getInstance();
    (manager as any).room = { localParticipant: { identity: 'p-host', publishData } };
    manager.setSessionContext({ roomId: 'room3', localParticipantId: 'p-host', hostToken: 'host-proof' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ roomId: 'room3', hostId: 'p-target', hostKey: 'hk2', generation: 2, delivered: true, timestamp: 1 })
    );

    await manager.transferHost('p-target');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(headers['X-Session-Capability']).toBe('session-cap');
    expect(headers['X-Host-Proof']).toBe('Bearer host-proof');
    expect((init.body as string)).toContain('p-target');

    const s = useAppStore.getState();
    expect(s.hostToken).toBeNull();
    expect(s.resumeHandle).toBeNull();

    expect(publishData).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(new TextDecoder().decode(publishData.mock.calls[0][0]));
    expect(publishData.mock.calls[0][1].topic).toBe(HOST_CONTROL_TOPIC);
    expect(frame.action).toBe('host-changed');
    expect(frame.newHostToken).toBeUndefined();
    expect(JSON.stringify(frame)).not.toContain('host-proof');
  });

  it('REG-03b host transfer fails closed when the private contract is unavailable', async () => {
    useAppStore.setState({ roomId: 'room3', participantId: 'p-host', jwt: 'access-token', sessionToken: null, hostToken: null });
    usePresenceStore.getState().setAuthoritativeHost('p-host');
    const manager = HostControlManager.getInstance();
    (manager as any).room = { localParticipant: { identity: 'p-host', publishData: vi.fn() } };
    manager.setLocalHostToken(null);

    await expect(manager.transferHost('p-target')).rejects.toThrow(/private session and host proof/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REG-04 host resume sends all four private headers and rotates credentials', async () => {
    seedHostSession('room4', 'p-host');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        token: 'access-token-2',
        livekitToken: 'livekit-2',
        participantId: 'p-host',
        roomId: 'room4',
        role: 'host',
        hostToken: 'host-proof-2',
        hostKey: 'host-key',
        sessionToken: 'session-cap-2',
        resumeHandle: 'resume-handle-2',
        roomInstanceId: 'rinst-1',
        sfuUrl: 'ws://sfu',
      })
    );

    await fetchToken('room4', 'Host');

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(headers['X-Session-Capability']).toBe('session-cap');
    expect(headers['X-Host-Proof']).toBe('Bearer host-proof');
    expect(headers['X-Resume-Handle']).toBe('resume-handle');

    const s = useAppStore.getState();
    expect(s.hostToken).toBe('host-proof-2');
    expect(s.resumeHandle).toBe('resume-handle-2');
    expect(s.sessionToken).toBe('session-cap-2');
  });

  it('REG-05 participant resume sends identity headers without a host proof', async () => {
    useAppStore.setState({
      roomId: 'room5',
      participantId: 'p-guest',
      jwt: 'access-token',
      livekitToken: 'livekit',
      sessionToken: 'guest-sc',
      resumeHandle: null,
      hostToken: null,
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 't2', livekitToken: 'lk2', participantId: 'p-guest', roomId: 'room5', role: 'participant', sessionToken: 'guest-sc2', sfuUrl: 'ws://sfu' })
    );

    await fetchToken('room5', 'Guest');

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer access-token');
    expect(headers['X-Session-Capability']).toBe('guest-sc');
    expect(headers['X-Host-Proof']).toBeUndefined();
    expect(headers['X-Resume-Handle']).toBeUndefined();
  });

  it('REG-06 invalid resume fails closed and never issues a guest session', async () => {
    seedHostSession('room6', 'p-host');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'resume_handle_invalid' }, 401));

    await expect(fetchToken('room6', 'Host')).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const s = useAppStore.getState();
    expect(s.hostToken).toBe('host-proof');
    expect(s.resumeHandle).toBe('resume-handle');
    expect(s.sessionToken).toBe('session-cap');
  });

  it('REG-07 host transfer works while the control channel reconnects without duplicate connections', async () => {
    seedHostSession('room7', 'p-host');
    usePresenceStore.getState().setAuthoritativeHost('p-host');

    const cc = ControlChannelManager.getInstance();
    cc.connect({ url: 'ws://test/signal', roomId: 'room7', participantId: 'p-host', jwt: 'access-token' });
    cc.connect({ url: 'ws://test/signal', roomId: 'room7', participantId: 'p-host', jwt: 'access-token' });
    expect(FakeWebSocket.instances.length).toBe(1);

    const publishData = vi.fn().mockResolvedValue(undefined);
    const manager = HostControlManager.getInstance();
    (manager as any).room = { localParticipant: { identity: 'p-host', publishData } };
    manager.setSessionContext({ roomId: 'room7', localParticipantId: 'p-host', hostToken: 'host-proof' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ roomId: 'room7', hostId: 'p-target', hostKey: 'hk', generation: 2, delivered: true }));
    await manager.transferHost('p-target');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('REG-08 resume handle rotation: the old handle is replaced and the new handle is used', async () => {
    seedHostSession('room8', 'p-host');
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ token: 't', livekitToken: 'lk', participantId: 'p-host', roomId: 'room8', role: 'host', hostToken: 'hp2', sessionToken: 'sc2', resumeHandle: 'rh2', roomInstanceId: 'ri', sfuUrl: 'ws://sfu' })
      )
      .mockResolvedValueOnce(
        jsonResponse({ token: 't', livekitToken: 'lk', participantId: 'p-host', roomId: 'room8', role: 'host', hostToken: 'hp2', sessionToken: 'sc2', resumeHandle: 'rh2', roomInstanceId: 'ri', sfuUrl: 'ws://sfu' })
      );

    await fetchToken('room8', 'Host');
    // First request carried the old handle.
    const first = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(first['X-Resume-Handle']).toBe('resume-handle');
    expect(useAppStore.getState().resumeHandle).toBe('rh2');

    await fetchToken('room8', 'Host');
    // Second request carries the rotated handle, not the consumed one.
    const second = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(second['X-Resume-Handle']).toBe('rh2');
  });

  it('REG-09 control channel delivers exactly one credential and suppresses duplicates', async () => {
    useAppStore.setState({ roomId: 'room9', participantId: 'p-target' });

    const cc = ControlChannelManager.getInstance();
    cc.connect({ url: 'ws://test/signal', roomId: 'room9', participantId: 'p-target', jwt: 'access-token' });
    await new Promise((r) => setTimeout(r, 0));

    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    const frame = {
      type: 'host-credential',
      payload: { hostToken: 'hp', hostKey: 'hk', roomInstanceId: 'ri', generation: 2, resumeHandle: 'rh' },
      roomId: 'room9',
      participantId: 'system',
      timestamp: 1,
    };
    ws.emit(frame);
    ws.emit(frame);

    expect(cc.getDeliveryCount()).toBe(1);
    const s = useAppStore.getState();
    expect(s.hostToken).toBe('hp');
    expect(s.resumeHandle).toBe('rh');
    expect(s.roomInstanceId).toBe('ri');

    cc.disconnect();
  });

  it('REG-09b control channel ignores malformed and non-target credentials', async () => {
    useAppStore.setState({ roomId: 'room9b', participantId: 'p-target' });

    const cc = ControlChannelManager.getInstance();
    cc.connect({ url: 'ws://test/signal', roomId: 'room9b', participantId: 'p-target', jwt: 'access-token' });
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

    ws.emit({ type: 'host-credential', payload: { hostToken: 123 }, roomId: 'room9b', participantId: 'system', timestamp: 1 });
    expect(cc.getDeliveryCount()).toBe(0);
    expect(useAppStore.getState().hostToken).toBeNull();

    cc.disconnect();
  });
});
