# M4A Milestone Specification — Authoritative Session Control

- **Milestone:** M4A — Authoritative Session Control
- **Status:** AUTHORIZED & ACTIVE 🎯
- **Authority:** Principal Product Manager & Technical Program Management
- **Prerequisites:** M0-P0 (Closed), M1 (Closed), M2 (Closed), M3A (Closed), M3B (Closed, tag `m3b-accepted`, commit `b1f824a`)
- **Timeline:** Sprint 1–2 (2 Weeks)
- **Governance:** 5-Gate Review (`@architect`, `@security`, `@privacy`, `@qa`, `@reviewer`)

---

## 1. Executive Summary & Paradigm Shift

With the foundational transport (M0-P0/M1), meeting ergonomics (M2), visual presentation (M3A), and multi-stream scalability (M3B) closed and verified, **the core operational surface of meet-secure is functionally complete**.

The highest-severity architectural risk facing the platform is no longer UI or media throughput: **it is trust, authority, and session integrity**.

### The Core Vulnerability in M2/M3
Prior to M4A, host authority operates under a client-assertive trust model:
```text
Client asserts: "I am the host"
Peers inspect: presence.hostId === senderId
```
Because the client generates and claims host status locally (e.g. first-joiner logic in `presenceStore.ts`), malicious or modified clients can forge host directives, spoof moderation packets, trigger unauthorized participant mutes/kicks, or usurp room ownership during network reconnects.

### The M4A Paradigm Shift
Milestone M4A moves the platform to a **cryptographically verifiable server-authoritative model**:
```text
Server certifies: "Participant P is the Authoritative Host for Room R"
Peers verify: Cryptographic signature, validity window, and role claim
```

**M4A Invariant:**
$$\text{No moderation action may be executed based solely on client assertions.}$$

---

## 2. Permanent Product Invariants & Constraints

The strict product exclusions from `AGENTS.md` remain **unconditionally binding**:

```
========================================================================================
                          PERMANENT PRODUCT EXCLUSIONS
========================================================================================
  ✗ AI summaries                   (Zero LLM/ML models processing meeting content)
  ✗ AI transcripts                 (Zero speech-to-text inference or audio ingestion)
  ✗ AI assistants / bots           (Zero automated non-human meeting participants)
  ✗ Attention / gaze tracking      (Zero biometric or gaze capture)
  ✗ Usage / engagement analytics   (Zero telemetry SDKs, zero telemetry endpoints)
  ✗ Behavioral tracking            (Zero user profiling or clickstream capture)
  ✗ Cloud recording                (Zero server-side media archiving or disk persistence)
  ✗ Cloud transcription            (Zero cloud-based audio processing)
  ✗ Server-side media transcoding  (Zero server-side composition, decoding, or relay changes)
========================================================================================
```

### Architectural Constraints
1. **Blind SFU Forwarding Preserved:** LiveKit SFU remains blind (`LIVEKIT_E2EE_MODE=blind`). No media decryption keys or SFrame session contexts are exposed to the server.
2. **Ephemeral In-Memory Room Authority:** Room session state in `meet-signal` is strictly in-memory (volatile Go maps/structs with Redis pub/sub replication). Zero disk persistence of attendee logs or room membership.
3. **Strict Session Lifecycles:** When all participants leave, room authority and keys are purged immediately ($TTL=0$).

---

## 3. Four Core Architectural Deliverables

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   M4A: AUTHORITATIVE SESSION CONTROL ARCHITECTURE                │
├─────────────────────────┬───────────────────────────┬────────────────────────────┤
│ 1. Server-Signed Host   │ 2. Authoritative Transfer │ 3. Signed Moderation Direct│
│  - JWT role claims      │  - POST /room/transfer    │  - Host token verification │
│  - First-joiner election│  - Atomic server update   │  - Anti-replay nonce/time  │
│  - Public key / HMAC ver│  - Signed host-changed    │  - Cryptographic drop guard│
├─────────────────────────┴───────────────────────────┴────────────────────────────┤
│ 4. Presence Reconciliation & Split-Brain Elimination                             │
│  - 30s disconnect grace period for host recovery                                 │
│  - Deterministic succession election on permanent host departure                 │
│  - Single source of truth: One room, One host, One authoritative truth           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### Deliverable 1: Server-Signed Host Identity & Server-Established Room Creation

#### 1.1 Signaling Service (`meet-signal`)
Host authority is derived exclusively from **Server-Established Room Creation**, not client assertions or network request timing. Client assertions (e.g. `{ isCreator: true }`) never grant authority.

- **Authoritative Room Creation (`POST /room/create`):**
  When a room originator creates a meeting:
  ```http
  POST /room/create
  Content-Type: application/json

  { "name": "Alice", "roomId": "room-alpha" }
  ```
  `meet-signal` deterministically registers the room in its in-memory authority registry, designates the caller as `HostID`, mints the ES256 server-signed host token, and returns:
  ```json
  {
    "roomId": "room-alpha",
    "participantId": "p-12345678",
    "role": "host",
    "hostToken": "<server-signed-jwt>",
    "hostKey": "<ecdsa-p256-public-key-hex>",
    "token": "<livekit-jwt>",
    "livekitToken": "<livekit-jwt>",
    "sfuUrl": "wss://host/rtc"
  }
  ```

- **Guest / Attendee Token Issuance (`POST /token`):**
  When invitees join an existing room (`{ roomId, name }`):
  `meet-signal` validates that the room exists. If the room has an active host and the caller is not the reconnecting host, `role` is strictly assigned as `"participant"`. No host token is minted. Any client claim attempting to assert host status is dropped.

- **Room State Registry:** `meet-signal` records active room authority in an in-memory thread-safe hub:
  ```go
  type RoomAuthority struct {
      RoomID        string
      HostID        string
      CreatedAt     time.Time
      HostUpdatedAt time.Time
      GraceExpiry   time.Time
      Locked        bool
  }
  ```

#### 1.2 Signed Token Claims
`meet-signal` issues tokens containing verifiable role assertions:
```json
{
  "sub": "p-12345678",
  "room": "room-alpha",
  "role": "host",
  "name": "Alice",
  "iss": "meet-signal",
  "aud": "room-alpha",
  "iat": 1757186400,
  "exp": 1757190000
}
```
For LiveKit access tokens, the role claim is encoded into the token `metadata` string:
```json
{
  "video": {
    "roomJoin": true,
    "room": "room-alpha",
    "canPublish": true,
    "canSubscribe": true,
    "canPublishData": true
  },
  "metadata": "{\"role\":\"host\"}",
  "sub": "p-12345678"
}
```

#### 1.3 Client-Side Host Authority & Single Source of Truth
- `usePresenceStore.hostId` is the **single source of truth** for host state.
- All host UI gates and permission evaluations are normalized strictly to:
  $$\text{isHost} = (\text{hostId} \ne \text{null} \ \land \ \text{hostId} === \text{localParticipantId})$$
- Elimination of Disappearing-Host Regression: `localParticipant.isHost` and `hostId` are immune to peer arrival or departures (`onParticipantConnected`/`onParticipantDisconnected`). Joining peers can never overwrite, displace, or desynchronize existing host authority.
- Clients never assume host status based on local participant count, join order, or self-assertions.

---

### Deliverable 2: Authoritative Host Transfer

#### 2.1 The Vulnerability of Peer-to-Peer Transfer
In M2, host transfer was a client broadcast (`transfer-host`) over the DataChannel. Any client could broadcast this message to depose the host or install an unauthorized host.

#### 2.2 Server-Arbitrated Transfer Flow
```text
Current Host Client                   meet-signal                      Peer Attendees
        │                                  │                                  │
        │── POST /room/:id/transfer ──────>│                                  │
        │   (Authorization: Bearer <JWT>)  │                                  │
        │   { targetParticipantId }        │                                  │
        │                                  │ [Verify sender is current host]  │
        │                                  │ [Verify target is in room]       │
        │                                  │ [Update RoomAuthority.HostID]    │
        │                                  │ [Mint new Host Claim for target] │
        │                                  │                                  │
        │<── 200 OK (role demoted) ────────│                                  │
        │                                  │── Broadcast "host-changed" ─────>│
        │                                  │   { newHostId, serverSig, exp }  │
```

1. **Endpoint:** `POST /room/:roomId/transfer-host`
2. **Authentication:** Validated against `Authorization: Bearer <host_jwt>`.
3. **Validation:**
   - Requester must match `RoomAuthority.HostID`.
   - Target must be an active connected participant in `RoomAuthority`.
4. **State Transition:** Atomically transfers authority.
5. **Broadcast:** Issues signed `host-changed` event to all room participants via WebSocket signaling and LiveKit DataChannel.

---

### Deliverable 3: Cryptographically Verified & Signed Moderation Directives

#### 3.1 Protected Moderation Actions
The following actions cannot be triggered without a verified server-issued Host Claim:
1. `mute-participant` (remote audio silence)
2. `remove-participant` (session termination / kick)
3. `spotlight-participant` (stage takeover)
4. `lock-room` (preventing new joiners)
5. `admit-waiting-room` / `reject-waiting-room` (entry authorization)

#### 3.2 Signed Directive Packet Shape
```typescript
export interface SignedHostDirective {
  action: 'mute-participant' | 'remove-participant' | 'spotlight-participant' | 'lock-room' | 'admit-waiting-room';
  targetParticipantId?: string;
  senderId: string;
  hostToken: string; // The full server-signed JWT proving host identity
  timestamp: number;
  nonce: string;
}
```

#### 3.3 Receiver Verification Pipeline
Before `HostControlManager` executes any directive, it performs four mandatory verification steps:
```text
Incoming Directive
       ↓
1. Cryptographic Signature Valid? (Signed by meet-signal)
       ↓ (YES)
2. Token Unexpired & Audience Matches Active Room? (now < exp && aud === roomId)
       ↓ (YES)
3. Token Subject Matches Sender Identity? (token.sub === senderId && token.role === 'host')
       ↓ (YES)
4. Freshness Window Valid? (|now - timestamp| <= 5000 ms)
       ↓ (YES)
Apply Action to Local Media / Session
```
If any check fails, the directive is logged to Ephemeral Runtime Diagnostics as an authorization anomaly and immediately discarded.

---

### Deliverable 4: Presence Reconciliation & Partition Recovery

#### 4.1 Host Disconnection Grace Period
When the host disconnects (browser crash, Wi-Fi blip, laptop sleep):
1. `meet-signal` detects disconnect and starts a **30-second Grace Timer**.
2. Room authority remains reserved for the host (`HostID`).
3. If the host reconnects within 30 seconds with their original token, they seamlessly resume host authority.

#### 4.2 Deterministic Host Succession
If the host fails to reconnect within 30 seconds:
1. `meet-signal` triggers **Succession Protocol**.
2. Successor is deterministically elected: the earliest connected participant in the room (`min(joinedAt)`).
3. `meet-signal` issues a signed `host-changed` directive to all remaining participants with the successor's ID.
4. If no participants remain, the room is deleted from memory.

#### 4.3 Network Partition Resolution
- A client reconnecting after a network partition queries `GET /room/:roomId/authority` or reads the signed signaling heartbeat.
- Local `presenceStore.hostId` is overwritten with the server's authoritative value.
- Split-brain dual-host states are eliminated by design.

---

### Deliverable 5: Meeting Entry & Leave Governance

#### 5.1 Waiting Room Enabled by Default
- New rooms initialize with `isWaitingRoomEnabled: true`.
- Unadmitted attendees are placed in an ephemeral waiting queue and knock (`waiting-room-knock`).
- Host explicitly admits (`waiting-room-admit`) or declines (`waiting-room-reject`) attendees. Host may toggle waiting room off if desired.

#### 5.2 Mandatory Display Name Validation
- Display name is strictly required:
  $$1 \le \text{displayName.trim().length} \le 64$$
- Whitespace-only or empty values are rejected. Join action is disabled until valid.
- User validation message: `"Display name is required."`

#### 5.3 Leave Confirmation Governance
- Prevent accidental disconnects and manage host departure:
  - **Participant Leave:** Confirmation modal `Leave Meeting? [Cancel] [Leave Meeting]`.
  - **Host Departure:**
    - If host is the final participant: leaving directly ends meeting and purges ephemeral room state ($TTL=0$).
    - If other participants are present: presents `Host Departure` modal with options to `[Cancel]`, `[Transfer & Leave]`, or `[Leave]` (initiating 30s grace and deterministic succession).

---

## 4. Test Matrix & Acceptance Gates

### Security Validation
| Test ID | Scenario | Expected Result |
|---|---|---|
| **M4A-SEC-01** | Attendee sends forged `mute-participant` with self-asserted host claim | Receiver rejects directive; zero audio disruption. |
| **M4A-SEC-02** | Non-host attempts `POST /room/:id/transfer-host` | Server returns `403 Forbidden`; host remains unchanged. |
| **M4A-SEC-03** | Attacker replays expired host token ($>3600\text{ s}$) | Receiver rejects expired token; directive dropped. |
| **M4A-SEC-04** | Attacker uses valid host token from Room A in Room B | Receiver rejects audience mismatch (`aud != roomId`). |
| **M4A-SEC-05** | Impostor participant modifies `sub` in JWT without private key | Signature verification fails; connection/directive dropped. |
| **M4A-SEC-09** | Guest submits forged creator claim (`isCreator: true` / self-minted) | Server grants zero host authority; participant role assigned. |
| **M4A-SEC-10** | Multiple participants join existing room with active host | Host controls and badge persist permanently; zero authority loss. |

### Network & Lifecycle Validation
| Test ID | Scenario | Expected Result |
|---|---|---|
| **M4A-NET-01** | Host blips network for 10s and reconnects | Reclaims host authority; zero succession churn. |
| **M4A-NET-02** | Host disconnects for 35s | 30s grace expires; oldest attendee elected successor authoritatively. |
| **M4A-NET-03** | Host transfers authority to Participant B | Participant B receives host token; all attendees update `hostId`. |
| **M4A-NET-04** | Partitioned client reconnects with stale host belief | Synchronizes with server authority on reconnect. |

### UX Governance Validation
| Test ID | Scenario | Expected Result |
|---|---|---|
| **M4A-UX-05** | User provides empty or whitespace-only display name | Join action disabled; `"Display name is required."` displayed. |
| **M4A-UX-06** | Guest joins meeting with default security settings | Guest enters waiting room; admitted only upon explicit host action. |

---

## 5. Milestone Exit Criteria

Milestone M4A exit requires unanimous sign-off across all 5 governance gates:

1. **Architecture Gate (`@architect`):** Single source of authority baselined in `meet-signal`. Deterministic host succession verified.
2. **Security Gate (`@security`):** All 5 security tests (`M4A-SEC-01` through `M4A-SEC-05`) passing. No client can execute moderation without cryptographic server proof.
3. **Privacy Gate (`@privacy`):** In-memory ephemeral authority only. Zero database persistence of attendee actions or session logs.
4. **QA Gate (`@qa`):** Complete test suite passing with $\ge 215$ tests. Zero regressions across M0–M3B features.
5. **Reviewer Gate (`@reviewer`):** TypeScript zero errors, production build under bundle budget ($\le 225\text{ kB}$ gzip), clean git hygiene.

---

## 6. Program Milestone Progression

```text
M0-P0  Architecture Validation        [CLOSED & ACCEPTED ✅]
M1     Production Hardening            [CLOSED & ACCEPTED ✅]
M2     Core Meeting Experience         [CLOSED & ACCEPTED ✅]
M3A    Advanced View Experience        [CLOSED & ACCEPTED ✅]
M3B    Multi-Stream Scalability        [CLOSED & ACCEPTED ✅]
-------------------------------------------------------------
M4A    Authoritative Session Control   [AUTHORIZED & ACTIVE 🎯]
M4B    Collaboration Maturity          [PLANNED 📋]
M5     Reliability & Recovery          [PLANNED 📋]
M6     Privacy-Hardened Release Cand.  [PLANNED 📋]
```
