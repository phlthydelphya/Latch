# V1 Current UX Journeys Inventory

**Status:** Inventory only. This document records current source and documentation evidence; it does not propose a redesigned UI. Statuses describe the evidence visible in this repository:

- **IMPLEMENTED**: a current source path visibly implements the behavior.
- **PARTIAL**: a meaningful path exists, but coverage, integration, or a required edge case is incomplete.
- **MISSING**: no current implementation evidence was found for the requested behavior.
- **CONFUSING/NEEDS VERIFICATION**: source and/or documentation is ambiguous, optimistic, contradictory, or requires runtime verification.

Line references are repository line ranges and should be refreshed if the cited files move.

## Invite Flow

| Field | Status | Current evidence |
|---|---|---|
| Create a meeting and generate an invitation | IMPLEMENTED | `poc/meet-webrtc-core/src/pages/LandingPage.tsx:197-249` validates the name, creates the room, generates a key, and presents a Meeting Ready step. |
| Canonical room URL and room-ID parsing | IMPLEMENTED | `poc/meet-webrtc-core/src/utils/roomUrl.ts:15-25,48-106,109-125` supports raw IDs, `/r/` URLs, and `#k=` extraction with validation. |
| Keep the invitation key in the URL fragment | IMPLEMENTED | `poc/meet-webrtc-core/src/utils/roomUrl.ts:109-116` formats `#k=`; `poc/meet-webrtc-core/src/pages/PreJoinPage.tsx:246-257` reads it locally before token fetch. ADR-006 is the governing model: `docs/adr/ADR-006-invitation-link-bearer-credential-model.md` (full document). |
| Copy link and human-readable invitation | IMPLEMENTED | `poc/meet-webrtc-core/src/pages/LandingPage.tsx:27-35,95-124` and `poc/meet-webrtc-core/src/components/InviteModal.tsx:59-77,142-201` provide both copy actions. |
| QR invitation | IMPLEMENTED | `poc/meet-webrtc-core/src/components/InviteModal.tsx:43-55,219-246` generates and displays a client-side QR code. |
| Admission remains separate from possession of the link | IMPLEMENTED | Invite copy says guests are admitted according to waiting-room settings: `poc/meet-webrtc-core/src/components/InviteModal.tsx:138-140`; the server-authoritative requirement is documented in `docs/releases/v1-scope.md:23-25,31-33`. |
| Invalid, missing, or locked room feedback | PARTIAL | Join pre-checks handle not-found and locked responses in `poc/meet-webrtc-core/src/pages/LandingPage.tsx:260-287`, but a failed status request proceeds optimistically. PreJoin renders the two known states at `poc/meet-webrtc-core/src/pages/PreJoinPage.tsx:350-395`. |
| Clipboard denial or copy fallback | MISSING | `InviteModal` catches clipboard failures without presenting a fallback or error at `poc/meet-webrtc-core/src/components/InviteModal.tsx:59-67,69-77`; the landing card does not catch them at `LandingPage.tsx:27-35`. |
| Expiry, revocation, replay, and invite abuse behavior | CONFUSING/NEEDS VERIFICATION | The release requirement calls for expiry/replay evidence, but marks it unchecked: `docs/releases/v1-scope.md:41-54`; the current URL utility has no expiry/revocation logic (`roomUrl.ts:109-146`). |

## Preflight Flow

| Field | Status | Current evidence |
|---|---|---|
| Room existence and lock check before joining | PARTIAL | PreJoin checks `/room/status` and renders not-found/locked states (`poc/meet-webrtc-core/src/pages/PreJoinPage.tsx:64-94,350-395`), but network failure proceeds optimistically (`:89-91`). |
| Required display name | IMPLEMENTED | Validation is computed and surfaced at `poc/meet-webrtc-core/src/pages/PreJoinPage.tsx:57-62,220-231,521-532`; the create/join landing forms also validate at `LandingPage.tsx:190-203,254-265`. |
| Local camera preview without publishing | IMPLEMENTED | Preview is composed locally at `PreJoinPage.tsx:43-55,213-218,430-447`; the page labels it `LOCAL ONLY` at `:424-428`. |
| Camera and microphone permission controls | IMPLEMENTED | Separate acquisition, stop, retry, busy, and error paths are present at `PreJoinPage.tsx:122-189,449-485`. |
| Speaker test | IMPLEMENTED | The preflight test creates a local tone and reports completion at `PreJoinPage.tsx:326-347,472-475,526-531`. |
| Input device selection before joining | IMPLEMENTED | Camera and microphone selects call `requestDevice` and are persisted on join at `PreJoinPage.tsx:488-513,294-303`. |
| Output device selection before joining | MISSING | Preflight stores a selected speaker ID (`PreJoinPage.tsx:30-32,115-118`) but renders only camera and microphone selects at `:488-505`; the note says speaker tests use the system output (`:513`). |
| In-flow recovery from permission/device errors | PARTIAL | Camera and microphone retry actions exist (`PreJoinPage.tsx:478-485`), while the general `deviceError` path has no matching retry action. |
| Invitation key required before token acquisition | IMPLEMENTED | `PreJoinPage.tsx:244-257` rejects a missing hash key before `fetchToken`; the app then carries the key in the meeting route at `:315-316`. |

## Waiting Room

| Field | Status | Current evidence |
|---|---|---|
| Waiting room default | IMPLEMENTED | Store initial state enables it at `poc/meet-webrtc-core/src/host/hostControlStore.ts:29-39`; the specification also states the default at `docs/M4A-authoritative-session-control.md:261-267`. |
| Guest enters a lobby instead of the call | IMPLEMENTED | Guest token handling sets `isWaitingInLobby` at `poc/meet-webrtc-core/src/pages/PreJoinPage.tsx:261-275`; MeetingPage gates the meeting at `poc/meet-webrtc-core/src/pages/MeetingPage.tsx:119-159`. |
| Host sees a waiting queue | IMPLEMENTED | Host controls read and render `waitingQueue` at `poc/meet-webrtc-core/src/components/host/HostControlsModal.tsx:20-23,332-443`. |
| Admit one, admit all, or decline | IMPLEMENTED | Actions are wired to `HostControlManager` at `HostControlsModal.tsx:51-64` and rendered at `:358-373,405-436`. |
| Guest sees explicit admitted transition | PARTIAL | The lobby says it will join automatically (`MeetingPage.tsx:140-145`), but the cited source does not show a distinct admitted confirmation or transition state; runtime signaling behavior needs verification. |
| Guest sees explicit rejection/denial state | MISSING | The source has a kicked interstitial (`MeetingPage.tsx:82-117`) but no waiting-room rejection-specific state or copy is shown in the waiting branch (`:123-159`). |
| Host can enable/disable the gate | IMPLEMENTED | Toggle and host-only disablement are implemented at `HostControlsModal.tsx:47-49,277-330`; store behavior when disabling is at `hostControlStore.ts:46-63`. |
| Waiting-room authorization survives refresh/reconnect | CONFUSING/NEEDS VERIFICATION | The release checklist explicitly requires refresh, reconnect, and denied-admission coverage but leaves it unchecked: `docs/releases/v1-scope.md:45-48`; the local queue/admission store is in-memory (`hostControlStore.ts:29-39`). |

## In-Room

| Field | Status | Current evidence |
|---|---|---|
| Core meeting shell, media controls, roster, chat, reactions | IMPLEMENTED | `poc/meet-webrtc-core/src/pages/MeetingPage.tsx:161-259` mounts the stage, control bar, roster, chat, reactions, device settings, host controls, and toasts. |
| Gallery, speaker, presentation, dynamic view, pins, and spotlight | IMPLEMENTED | View controls are rendered at `poc/meet-webrtc-core/src/components/layout/LayoutControls.tsx:25-58`; layout state and pin/spotlight arbitration are implemented at `poc/meet-webrtc-core/src/layout/layoutStore.ts:44-62,66-207`. |
| Layout behavior at supported participant/stream limits | CONFUSING/NEEDS VERIFICATION | The release scope requires verification of gallery, speaker, multi-pin, and screen-share layouts (`docs/releases/v1-scope.md:49-51`), while the current source alone does not establish the runtime matrix. |
| In-room hardware switching | IMPLEMENTED | Device settings enumerate devices, listen for changes, switch audio/video inputs and output, test speakers, and expose diagnostics at `poc/meet-webrtc-core/src/components/devices/DeviceSettingsModal.tsx:42-94,162-200,205-340`. |
| Server-authoritative host controls | PARTIAL | Host identity is derived from `presenceStore.hostId` in `poc/meet-webrtc-core/src/pages/MeetingPage.tsx:52-60` and protected UI actions are host-gated in `HostControlsModal.tsx:43-70`; independent end-to-end evidence remains a release requirement (`docs/releases/v1-scope.md:45-54`). |
| Co-host assignment and lifecycle UI | PARTIAL | A co-host registry and moderation hierarchy exist in `poc/meet-webrtc-core/src/hooks/usePermissions.ts:1-15,22-52,72-102`, but no assignment/revoke controls are shown in the host modal (`HostControlsModal.tsx:149-216,445-573`). |
| Leave confirmation and host departure choices | IMPLEMENTED | The specification defines participant and host departure choices at `docs/M4A-authoritative-session-control.md:261-280`; current MeetingPage delegates leaving to `webrtcLeave` and clears the room at `poc/meet-webrtc-core/src/pages/MeetingPage.tsx:76-80`. The exact modal path requires runtime/source verification outside this file. |
| Encryption and fallback state honesty | PARTIAL | Meeting copy exposes an encryption state concept (`docs/releases/v1-scope.md:18-21`), but the release checklist requires explicit runtime verification of no silent downgrade (`v1-scope.md:50-54`); this inventory found no complete in-room state matrix. |

## Recovery

| Field | Status | Current evidence |
|---|---|---|
| Signaling reconnect with backoff | IMPLEMENTED | `poc/meet-webrtc-core/src/reconnect/manager.ts:48-105` starts reconnect, emits state, uses exponential delay, and retries until the configured maximum. |
| ICE restart during reconnect | IMPLEMENTED | The manager invokes the configured ICE restart offer once at `reconnect/manager.ts:84-95`. |
| User-visible reconnecting/connected/failed states | PARTIAL | The manager emits `reconnecting`, `reconnected`, and `failed` events (`reconnect/manager.ts:61-63,119-149`), while MeetingPage visibly shows only the generic not-connected overlay at `MeetingPage.tsx:216-232`. |
| Preserve encryption epoch and replay buffered messages | PARTIAL | State fields and replay exist at `reconnect/manager.ts:9-16,107-128,152-171`; actual key/session integration and user-visible encryption-state handling are release requirements, not established by this class. |
| Host grace and deterministic succession | IMPLEMENTED (DOCUMENTED) | The authoritative specification documents 30-second grace, earliest-participant succession, and purge at `docs/M4A-authoritative-session-control.md:239-257`. Runtime verification is separately required by `docs/releases/v1-release-tickets.md:228-247`. |
| Refresh/rejoin authorization and room recovery | CONFUSING/NEEDS VERIFICATION | The release scope requires reconnect/session resume with preserved authorization and encryption handling (`docs/releases/v1-scope.md:35-39,50-53`); current source evidence does not demonstrate the complete refresh/rejoin journey. |
| Offline/PWA recovery behavior | CONFUSING/NEEDS VERIFICATION | PWA install/update/cache verification is an unchecked V1 evidence item (`docs/releases/v1-scope.md:52-54`), so no shipped recovery claim is made here. |

## Inventory Boundary

This file deliberately does not convert the V1 scope checklist into completion claims. The scope document says its checklist is an evidence requirement, not a current-pass assertion (`docs/releases/v1-scope.md:8-12,41-43`), and the release ticket plan keeps all work `NOT YET VERIFIED` (`docs/releases/v1-release-tickets.md:1-5,56-76`).
