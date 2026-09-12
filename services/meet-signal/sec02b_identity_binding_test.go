package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// sec02bIssueSession issues a private session capability into the package
// sessionManager and returns it.
func sec02bIssueSession(t *testing.T, participantID, roomInstanceID, purpose string) string {
	t.Helper()
	cap, err := sessionManager.issue(participantID, roomInstanceID, purpose, 5*time.Minute)
	if err != nil {
		t.Fatalf("session fixture issuance failed: %v", err)
	}
	return cap
}

func sec02bIssueResumeHandle(t *testing.T, rh *resumeHandleStore, participantID, roomInstanceID string, generation uint64) string {
	t.Helper()
	handle, err := rh.issue(participantID, roomInstanceID, generation, 1, 5*time.Minute)
	if err != nil {
		t.Fatalf("resume handle fixture issuance failed: %v", err)
	}
	return handle
}

func sec02bAssertError(t *testing.T, got, want error) {
	t.Helper()
	if want == nil {
		if got != nil {
			t.Fatalf("expected success, got error: %v", got)
		}
		return
	}
	if !errors.Is(got, want) {
		t.Fatalf("expected error %q, got %q", want, got)
	}
}

func TestSEC02BSessionStoreLifecycle(t *testing.T) {
	ss := newSessionStore()
	cap, err := ss.issue("p-alice", "inst-1", "host", 5*time.Minute)
	if err != nil || cap == "" {
		t.Fatalf("session issue failed: %v", err)
	}

	rec, ok := ss.authenticate(cap)
	if !ok || rec.ParticipantID != "p-alice" || rec.RoomInstanceID != "inst-1" || rec.Purpose != "host" || rec.SessionVersion != 1 {
		t.Errorf("authenticate returned unexpected record: %+v (ok=%v)", rec, ok)
	}

	rotated, err := ss.rotate(cap, 5*time.Minute)
	if err != nil {
		t.Fatalf("rotate failed: %v", err)
	}
	if rotated == cap || rotated == "" {
		t.Error("rotate did not produce a distinct replacement capability")
	}
	if _, ok := ss.authenticate(cap); ok {
		t.Error("rotated-away capability still authenticates")
	}
	newRec, ok := ss.authenticate(rotated)
	if !ok || newRec.SessionVersion != 2 || newRec.ParticipantID != "p-alice" {
		t.Errorf("rotated session record incorrect: %+v (ok=%v)", newRec, ok)
	}

	ss.revoke(rotated)
	if _, ok := ss.authenticate(rotated); ok {
		t.Error("revoked capability still authenticates")
	}
}

func TestSEC02BSessionExpiryAndHasActive(t *testing.T) {
	ss := newSessionStore()
	expired, err := ss.issue("p-alice", "inst-1", "host", -time.Minute)
	if err != nil {
		t.Fatalf("expired fixture issuance failed: %v", err)
	}
	if _, ok := ss.authenticate(expired); ok {
		t.Error("expired session authenticates")
	}
	if _, err := ss.rotate(expired, 5*time.Minute); !errors.Is(err, errPrivateSessionInvalid) {
		t.Errorf("rotating expired session returned %v; want errPrivateSessionInvalid", err)
	}

	_, _ = ss.issue("p-bob", "inst-1", "participant", 5*time.Minute)
	if !ss.hasActiveSession("p-bob", "inst-1") {
		t.Error("hasActiveSession should be true for an active session")
	}
	if ss.hasActiveSession("p-bob", "inst-other") {
		t.Error("hasActiveSession should be false for a different room instance")
	}
	if ss.hasActiveSession("p-nobody", "inst-1") {
		t.Error("hasActiveSession should be false for an unknown participant")
	}
}

func TestSEC02BCredentialPurposeSeparation(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02b-purpose-room"
			sec02aRoom(t, roomID, "p-host")
			hostToken := sec02aHostToken(t, "p-host", roomID)
			accessToken := sec02aAccessToken(t, "p-host", roomID, liveKit)

			if _, err := validateAccessToken(hostToken); err == nil {
				t.Error("ES256 host token accepted as access credential")
			}
			if _, err := validateHostToken(accessToken); err == nil {
				t.Error("HS256 access token accepted as host-operation proof")
			}
			if _, err := validateHostToken(hostToken); err != nil {
				t.Errorf("validateHostToken rejected a valid host token: %v", err)
			}
			if _, err := validateAccessToken(accessToken); err != nil {
				t.Errorf("validateAccessToken rejected a valid access token: %v", err)
			}
		})
	}
}

func TestSEC02BCreateRoomSessionIssuance(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			r := httptest.NewRequest(http.MethodPost, "/room/create", strings.NewReader(`{"roomId":"sec02b-bootstrap-room","name":"Synthetic Host"}`))
			w := httptest.NewRecorder()
			handleCreateRoom(w, r)

			var resp TokenResponse
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || w.Code != http.StatusOK {
				t.Fatalf("create room failed: status=%d err=%v", w.Code, err)
			}
			if resp.SessionToken == "" || resp.RoomInstanceID == "" {
				t.Error("create room did not issue sessionToken/roomInstanceId")
			}
			if resp.Role != "host" || resp.HostToken == "" {
				t.Errorf("create room did not retain host contract: role=%s", resp.Role)
			}
			rec, ok := sessionManager.authenticate(resp.SessionToken)
			if !ok || rec.Purpose != "host" || rec.ParticipantID != resp.ParticipantID || rec.RoomInstanceID != resp.RoomInstanceID {
				t.Errorf("host session not bound correctly: %+v (ok=%v)", rec, ok)
			}
		})
	}
}

func TestSEC02BGuestIssuanceIncludesSession(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			r := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(`{"roomId":"sec02b-guest-room","name":"Synthetic Guest"}`))
			w := httptest.NewRecorder()
			handleToken(w, r)

			var resp TokenResponse
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || w.Code != http.StatusOK {
				t.Fatalf("guest token failed: status=%d err=%v", w.Code, err)
			}
			if resp.Role != "participant" || resp.HostToken != "" {
				t.Errorf("guest issuance did not stay participant-only: role=%s hostToken=%q", resp.Role, resp.HostToken)
			}
			if resp.SessionToken == "" || resp.RoomInstanceID == "" {
				t.Error("guest issuance did not include session credential")
			}
			rec, ok := sessionManager.authenticate(resp.SessionToken)
			if !ok || rec.Purpose != "participant" || rec.ParticipantID != resp.ParticipantID || rec.RoomInstanceID != resp.RoomInstanceID {
				t.Errorf("guest session not bound correctly: %+v (ok=%v)", rec, ok)
			}
		})
	}
}

func TestSEC02BResumeIdentityHostSuccess(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02b-resume-host"
			before := sec02aRoom(t, roomID, "p-host")
			access := sec02aAccessToken(t, "p-host", roomID, liveKit)
			proof := sec02aHostToken(t, "p-host", roomID)
			session := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
			rh := newResumeHandleStore()
			handle := sec02bIssueResumeHandle(t, rh, "p-host", before.RoomInstanceID, before.AuthorityGeneration)

			participantID, isHost, err := resumeIdentity(authManager, sessionManager, rh, roomID, access, session, proof, handle)
			if err != nil || !isHost || participantID != "p-host" {
				t.Fatalf("host resume failed: participantID=%s isHost=%v err=%v", participantID, isHost, err)
			}
		})
	}
}

func TestSEC02BResumeIdentityRejections(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02b-resume-reject"
			before := sec02aRoom(t, roomID, "p-host")
			hostAccess := sec02aAccessToken(t, "p-host", roomID, liveKit)
			hostProof := sec02aHostToken(t, "p-host", roomID)
			targetAccess := sec02aAccessToken(t, "p-target", roomID, liveKit)
			hostSession := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
			targetSession := sec02bIssueSession(t, "p-target", before.RoomInstanceID, "participant")
			wrongRoomAccess := sec02aAccessToken(t, "p-host", "sec02b-other-room", liveKit)
			rh := newResumeHandleStore()

			cases := []struct {
				name      string
				access    string
				session   string
				proof     string
				wantErr   error
			}{
				{"host_attestation_alone_as_access", hostProof, "", "", errPrivateSessionRequired},
				{"missing_session", hostAccess, "", hostProof, errPrivateSessionInvalid},
				{"subject_mismatch_session", targetAccess, hostSession, hostProof, errIdentityMismatch},
				{"host_proof_subject_mismatch", hostAccess, hostSession, sec02aHostToken(t, "p-target", roomID), errIdentityMismatch},
				{"wrong_room", wrongRoomAccess, hostSession, hostProof, errIdentityMismatch},
				{"missing_host_proof_for_host", hostAccess, hostSession, "", errHostProofRequired},
			}

			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					_, _, err := resumeIdentity(authManager, sessionManager, rh, roomID, tc.access, tc.session, tc.proof, "")
					sec02bAssertError(t, err, tc.wantErr)
				})
			}

			// A participant with valid identity+session resumes as participant,
			// never as host, regardless of any supplied host attestation.
			participantID, isHost, err := resumeIdentity(authManager, sessionManager, rh, roomID, targetAccess, targetSession, "", "")
			if err != nil || isHost || participantID != "p-target" {
				t.Errorf("participant resume should return isHost=false: id=%s host=%v err=%v", participantID, isHost, err)
			}
		})
	}
}

func TestSEC02BResumeExpiredSessionRejected(t *testing.T) {
	sec02aConfigure(t, false)
	roomID := "sec02b-resume-expired"
	before := sec02aRoom(t, roomID, "p-host")
	access := sec02aAccessToken(t, "p-host", roomID, false)
	proof := sec02aHostToken(t, "p-host", roomID)
	expired, err := sessionManager.issue("p-host", before.RoomInstanceID, "host", -time.Minute)
	if err != nil {
		t.Fatalf("expired session fixture failed: %v", err)
	}
	_, _, err = resumeIdentity(authManager, sessionManager, newResumeHandleStore(), roomID, access, expired, proof, "")
	sec02bAssertError(t, err, errPrivateSessionInvalid)
}

func TestSEC02BTransferIdentityHostSuccess(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02b-transfer-host"
			before := sec02aRoom(t, roomID, "p-host")
			hostAccess := sec02aAccessToken(t, "p-host", roomID, liveKit)
			hostProof := sec02aHostToken(t, "p-host", roomID)
			hostSession := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
			sec02bIssueSession(t, "p-target", before.RoomInstanceID, "participant")

			if err := transferHostIdentity(authManager, sessionManager, roomID, hostAccess, hostSession, hostProof, "p-target"); err != nil {
				t.Fatalf("transfer failed: %v", err)
			}
			auth, ok := authManager.getAuthority(roomID)
			if !ok || auth.HostID != "p-target" {
				t.Errorf("transfer did not move authority to target: %+v (ok=%v)", auth, ok)
			}
		})
	}
}

func TestSEC02BTransferIdentityRejections(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02b-transfer-reject"
			before := sec02aRoom(t, roomID, "p-host")
			hostAccess := sec02aAccessToken(t, "p-host", roomID, liveKit)
			hostProof := sec02aHostToken(t, "p-host", roomID)
			hostSession := sec02bIssueSession(t, "p-host", before.RoomInstanceID, "host")
			targetAccess := sec02aAccessToken(t, "p-target", roomID, liveKit)
			targetSession := sec02bIssueSession(t, "p-target", before.RoomInstanceID, "participant")
			wrongRoomAccess := sec02aAccessToken(t, "p-host", "sec02b-other-room", liveKit)

			// A target for the "no target session" cases.
			sec02bIssueSession(t, "p-real", before.RoomInstanceID, "participant")

			cases := []struct {
				name    string
				access  string
				session string
				proof   string
				target  string
				wantErr error
			}{
				{"host_attestation_alone_as_access", hostProof, "", "", "p-target", errPrivateSessionRequired},
				{"missing_session", hostAccess, "", hostProof, "p-target", errPrivateSessionInvalid},
				{"non_host_session", targetAccess, targetSession, hostProof, "p-target", errIdentityMismatch},
				{"host_proof_subject_mismatch", hostAccess, hostSession, sec02aHostToken(t, "p-target", roomID), "p-target", errIdentityMismatch},
				{"wrong_room", wrongRoomAccess, hostSession, hostProof, "p-target", errIdentityMismatch},
				{"missing_host_proof", hostAccess, hostSession, "", "p-target", errHostProofRequired},
				{"target_without_session", hostAccess, hostSession, hostProof, "p-ghost", errTransferTargetUnauthenticated},
				{"target_is_self", hostAccess, hostSession, hostProof, "p-host", errTransferTargetUnauthenticated},
			}

			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					err := transferHostIdentity(authManager, sessionManager, roomID, tc.access, tc.session, tc.proof, tc.target)
					sec02bAssertError(t, err, tc.wantErr)
				})
			}
		})
	}
}

// TestSEC02BPrivateDeliveryTargetOnly proves the private delivery helper writes
// a host credential to the target's connection and to no other peer.
func TestSEC02BPrivateDeliveryTargetOnly(t *testing.T) {
	sec02aConfigure(t, false)
	roomID := "sec02b-delivery"
	sec02aRoom(t, roomID, "p-host")

	h := newHub()
	var handlers sync.WaitGroup
	mux := http.NewServeMux()
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
		handlers.Add(1)
		defer handlers.Done()
		handleSignal(h, w, r)
	})
	server := httptest.NewServer(mux)
	var connections []*websocket.Conn
	t.Cleanup(func() {
		for _, connection := range connections {
			connection.Close()
		}
		server.Close()
		handlers.Wait()
	})

	participants := []string{"p-host", "p-target-b", "p-observer-x"}
	for index, participant := range participants {
		header := http.Header{"Authorization": {"Bearer " + sec02aAccessToken(t, participant, roomID, false)}}
		connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/signal?room="+roomID, header)
		if err != nil {
			if response != nil {
				response.Body.Close()
			}
			t.Fatalf("fixture WebSocket connection failed: %v", err)
		}
		connections = append(connections, connection)
		for peerIndex, peer := range connections {
			count := 1
			if peerIndex == index {
				count = index
			}
			for i := 0; i < count; i++ {
				peer.SetReadDeadline(time.Now().Add(3 * time.Second))
				var frame SignalMessage
				if peer.ReadJSON(&frame) != nil || frame.Type != "join" {
					t.Fatal("fixture did not complete deterministic peer join exchange")
				}
			}
		}
	}

	payload := json.RawMessage(`{"action":"host-changed","newHostToken":"synthetic-private-credential"}`)
	if !h.deliverHostCredential(roomID, "p-target-b", payload) {
		t.Fatal("deliverHostCredential returned false for connected target")
	}

	peers := h.peers(roomID, nil)
	if len(peers) != 3 {
		t.Fatalf("fixture has %d peers; want three", len(peers))
	}
	for _, peer := range peers {
		if peer.writeJSON(SignalMessage{Type: "sec02b-barrier"}) != nil {
			t.Fatal("failed to write peer barrier")
		}
	}

	for index, connection := range connections {
		connection.SetReadDeadline(time.Now().Add(3 * time.Second))
		receivedCredential := false
		for {
			var frame SignalMessage
			if connection.ReadJSON(&frame) != nil {
				t.Fatal("failed to receive peer barrier")
			}
			if frame.Type == "sec02b-barrier" {
				break
			}
			if frame.Type == "host-credential" {
				receivedCredential = true
			}
		}
		if participants[index] == "p-target-b" {
			if !receivedCredential {
				t.Error("target B did not receive the private credential frame")
			}
		} else if receivedCredential {
			t.Errorf("non-target %s received the private credential frame", participants[index])
		}
	}
}

func TestSEC02BPrivateDeliveryMissingTargetFailsClosed(t *testing.T) {
	sec02aConfigure(t, false)
	h := newHub()
	payload := json.RawMessage(`{"action":"host-changed"}`)
	if h.deliverHostCredential("sec02b-no-room", "p-ghost", payload) {
		t.Error("deliverHostCredential should return false when no target connection exists")
	}
}