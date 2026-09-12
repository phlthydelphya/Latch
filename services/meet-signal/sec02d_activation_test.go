package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// SEC-02D activation integration tests exercise the public HTTP endpoints and
// real WebSocket signaling connections. They complement the primitive-level
// SEC-02B/C tests by proving the wired behavior end to end.

func sec02dServer(h *hub) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/room/create", handleCreateRoom)
	mux.HandleFunc("/token", handleToken)
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) { handleSignal(h, w, r) })
	mux.HandleFunc("/room/transfer-host", func(w http.ResponseWriter, r *http.Request) {
		handleTransferHost(h, authManager, w, r)
	})
	return httptest.NewServer(mux)
}

func sec02dCreateRoom(t *testing.T, server *httptest.Server, roomID string) TokenResponse {
	t.Helper()
	response, err := http.Post(server.URL+"/room/create", "application/json",
		strings.NewReader(`{"roomId":"`+roomID+`","name":"Synthetic Host"}`))
	if err != nil {
		t.Fatalf("room creation request failed: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("room creation returned %d", response.StatusCode)
	}
	var result TokenResponse
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("room creation response was not decodable")
	}
	if result.Role != "host" || result.HostToken == "" || result.SessionToken == "" || result.ResumeHandle == "" || result.RoomInstanceID == "" || result.Token == "" {
		t.Fatalf("room creation did not return the full host bootstrap contract")
	}
	return result
}

func sec02dGuest(t *testing.T, server *httptest.Server, roomID, name string) TokenResponse {
	t.Helper()
	response, err := http.Post(server.URL+"/token", "application/json",
		strings.NewReader(`{"roomId":"`+roomID+`","name":"`+name+`"}`))
	if err != nil {
		t.Fatalf("guest issuance request failed: %v", err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("guest issuance returned %d", response.StatusCode)
	}
	var result TokenResponse
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("guest issuance response was not decodable")
	}
	return result
}

func sec02dResume(t *testing.T, server *httptest.Server, roomID, access, session, proof, handle string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/token",
		strings.NewReader(`{"roomId":"`+roomID+`","name":"Synthetic Resume"}`))
	req.Header.Set("Content-Type", "application/json")
	if access != "" {
		req.Header.Set("Authorization", "Bearer "+access)
	}
	if session != "" {
		req.Header.Set("X-Session-Capability", session)
	}
	if proof != "" {
		req.Header.Set("X-Host-Proof", "Bearer "+proof)
	}
	if handle != "" {
		req.Header.Set("X-Resume-Handle", handle)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("resume request failed: %v", err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	return response, body
}

func sec02dTransfer(t *testing.T, server *httptest.Server, roomID, target, access, session, proof string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/room/transfer-host",
		strings.NewReader(`{"roomId":"`+roomID+`","targetParticipantId":"`+target+`"}`))
	req.Header.Set("Content-Type", "application/json")
	if access != "" {
		req.Header.Set("Authorization", "Bearer "+access)
	}
	if session != "" {
		req.Header.Set("X-Session-Capability", session)
	}
	if proof != "" {
		req.Header.Set("X-Host-Proof", "Bearer "+proof)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("transfer request failed: %v", err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	return response, body
}

func sec02dDial(t *testing.T, server *httptest.Server, roomID, access string) *websocket.Conn {
	t.Helper()
	header := http.Header{"Authorization": {"Bearer " + access}}
	conn, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/signal?room="+roomID, header)
	if err != nil {
		if response != nil {
			response.Body.Close()
		}
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	return conn
}

func sec02dReadFrame(t *testing.T, conn *websocket.Conn) SignalMessage {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var frame SignalMessage
	if err := conn.ReadJSON(&frame); err != nil {
		t.Fatalf("expected a signaling frame but read failed: %v", err)
	}
	return frame
}

// TestSEC02DActivationHostResumeHTTP proves a legitimate host resumes through
// the public /token endpoint, receives rotated credentials, and that replay of
// the consumed resume handle or rotated session fails closed.
func TestSEC02DActivationHostResumeHTTP(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			server := sec02dServer(newHub())
			defer server.Close()

			host := sec02dCreateRoom(t, server, "sec02d-resume-room")

			response, body := sec02dResume(t, server, "sec02d-resume-room", host.Token, host.SessionToken, host.HostToken, host.ResumeHandle)
			if response.StatusCode != http.StatusOK {
				t.Fatalf("host resume returned %d, body=%s", response.StatusCode, strings.TrimSpace(string(body)))
			}
			var resumed TokenResponse
			if err := json.Unmarshal(body, &resumed); err != nil {
				t.Fatalf("host resume response was not decodable")
			}
			if resumed.Role != "host" || resumed.ParticipantID != host.ParticipantID || resumed.HostToken == "" || resumed.SessionToken == "" || resumed.ResumeHandle == "" {
				t.Fatalf("host resume did not preserve identity and rotate credentials")
			}
			if resumed.SessionToken == host.SessionToken || resumed.ResumeHandle == host.ResumeHandle {
				t.Fatalf("host resume did not rotate session capability and resume handle")
			}

			// Replay of the consumed resume handle fails closed.
			replayStatus, replayBody := sec02dResume(t, server, "sec02d-resume-room", host.Token, host.SessionToken, host.HostToken, host.ResumeHandle)
			if replayStatus.StatusCode != http.StatusUnauthorized {
				t.Errorf("resume handle replay returned %d; want 401", replayStatus.StatusCode)
			}
			sec02aAssertNoCredentials(t, replayBody)

			// The rotated session capability no longer authenticates.
			rotatedStatus, rotatedBody := sec02dResume(t, server, "sec02d-resume-room", host.Token, host.SessionToken, host.HostToken, resumed.ResumeHandle)
			if rotatedStatus.StatusCode != http.StatusUnauthorized {
				t.Errorf("rotated session reuse returned %d; want 401", rotatedStatus.StatusCode)
			}
			sec02aAssertNoCredentials(t, rotatedBody)

			// Ordinary guests still receive participant-only credentials.
			guest := sec02dGuest(t, server, "sec02d-resume-room", "Synthetic Guest")
			if guest.Role != "participant" || guest.HostToken != "" || guest.SessionToken == "" {
				t.Errorf("guest issuance no longer participant-only")
			}
		})
	}
}

// TestSEC02DActivationTransferTargetOnlyWebSocket proves an authenticated host
// transfer succeeds through the public endpoint, delivers the target credential
// only to the target's WebSocket connection, and never returns it to the
// outgoing host.
func TestSEC02DActivationTransferTargetOnlyWebSocket(t *testing.T) {
	sec02aConfigure(t, false)
	h := newHub()
	server := sec02dServer(h)
	defer server.Close()

	const roomID = "sec02d-transfer-room"
	hostA := sec02dCreateRoom(t, server, roomID)
	guestB := sec02dGuest(t, server, roomID, "Synthetic Target")

	connA := sec02dDial(t, server, roomID, hostA.Token)
	defer connA.Close()
	connB := sec02dDial(t, server, roomID, guestB.Token)
	defer connB.Close()

	// Complete the deterministic peer join exchange: A sees B join, B sees A.
	if frame := sec02dReadFrame(t, connA); frame.Type != "join" || frame.ParticipantID != guestB.ParticipantID {
		t.Fatalf("outgoing host did not observe target join")
	}
	if frame := sec02dReadFrame(t, connB); frame.Type != "join" || frame.ParticipantID != hostA.ParticipantID {
		t.Fatalf("target did not observe host join")
	}

	status, body := sec02dTransfer(t, server, roomID, guestB.ParticipantID, hostA.Token, hostA.SessionToken, hostA.HostToken)
	if status.StatusCode != http.StatusOK {
		t.Fatalf("authenticated transfer returned %d, body=%s", status.StatusCode, strings.TrimSpace(string(body)))
	}
	if strings.Contains(string(body), "hostToken") || strings.Contains(string(body), "eyJ") {
		t.Fatalf("transfer response leaked a credential to the outgoing host")
	}
	var meta map[string]any
	if err := json.Unmarshal(body, &meta); err != nil || meta["delivered"] != true || meta["hostId"] != guestB.ParticipantID {
		t.Fatalf("transfer response missing delivered public metadata")
	}

	// Deliver a barrier to every peer, then prove only the target received the
	// private host credential.
	for _, peer := range h.peers(roomID, nil) {
		if err := peer.writeJSON(SignalMessage{Type: "sec02d-barrier"}); err != nil {
			t.Fatalf("failed to write barrier")
		}
	}

	targetCredentialSeen := false
	for {
		frame := sec02dReadFrame(t, connB)
		if frame.Type == "host-credential" {
			targetCredentialSeen = true
			var payload struct {
				HostToken    string `json:"hostToken"`
				ResumeHandle string `json:"resumeHandle"`
				Generation   uint64 `json:"generation"`
			}
			if err := json.Unmarshal(frame.Payload, &payload); err != nil || payload.HostToken == "" || payload.ResumeHandle == "" || payload.Generation == 0 {
				t.Fatalf("target credential frame missing bound host material")
			}
			continue
		}
		if frame.Type == "sec02d-barrier" {
			break
		}
	}
	if !targetCredentialSeen {
		t.Fatalf("target did not receive its private host credential")
	}

	for {
		frame := sec02dReadFrame(t, connA)
		if frame.Type == "host-credential" {
			t.Fatalf("outgoing host received the target host credential")
		}
		if frame.Type == "sec02d-barrier" {
			break
		}
	}

	// The transferred target is now the authoritative host.
	authority, ok := authManager.getAuthority(roomID)
	if !ok || authority.HostID != guestB.ParticipantID || authority.AuthorityGeneration != 2 {
		t.Fatalf("transfer did not commit the expected authority generation")
	}
}

// TestSEC02DReplayAndGenerationRejected proves captured credentials cannot
// regain authority and a stale-generation proof is refused at the public
// endpoint.
func TestSEC02DReplayAndGenerationRejected(t *testing.T) {
	sec02aConfigure(t, false)
	h := newHub()
	server := sec02dServer(h)
	defer server.Close()

	const roomID = "sec02d-replay-room"
	hostA := sec02dCreateRoom(t, server, roomID)
	guestB := sec02dGuest(t, server, roomID, "Synthetic Target")

	connA := sec02dDial(t, server, roomID, hostA.Token)
	defer connA.Close()
	connB := sec02dDial(t, server, roomID, guestB.Token)
	defer connB.Close()
	sec02dReadFrame(t, connA) // join B
	sec02dReadFrame(t, connB) // join A

	status, body := sec02dTransfer(t, server, roomID, guestB.ParticipantID, hostA.Token, hostA.SessionToken, hostA.HostToken)
	if status.StatusCode != http.StatusOK {
		t.Fatalf("initial transfer returned %d, body=%s", status.StatusCode, strings.TrimSpace(string(body)))
	}

	// Replaying A's original host credential to /token must not regain authority;
	// A is no longer the host, so it resumes only as a participant.
	replayStatus, replayBody := sec02dResume(t, server, roomID, hostA.Token, hostA.SessionToken, hostA.HostToken, hostA.ResumeHandle)
	if replayStatus.StatusCode != http.StatusOK {
		t.Fatalf("deposed host resume returned %d", replayStatus.StatusCode)
	}
	var deposed TokenResponse
	if err := json.Unmarshal(replayBody, &deposed); err != nil || deposed.Role != "participant" || deposed.HostToken != "" {
		t.Fatalf("deposed host regained authority through replay")
	}

	// A stale-generation host proof for the current host (B) is refused.
	authority, _ := authManager.getAuthority(roomID)
	staleProof, err := mintHostToken(guestB.ParticipantID, roomID, authority.RoomInstanceID, 1, 5*time.Minute)
	if err != nil {
		t.Fatalf("stale proof fixture signing failed")
	}
	staleStatus, staleBody := sec02dTransfer(t, server, roomID, hostA.ParticipantID, guestB.Token, guestB.SessionToken, staleProof)
	if staleStatus.StatusCode == http.StatusOK {
		t.Fatalf("stale-generation transfer succeeded; want fail-closed")
	}
	sec02aAssertNoCredentials(t, staleBody)

	// B's session capability must not authenticate the privileged path without
	// a valid host proof.
	noProofStatus, noProofBody := sec02dResume(t, server, roomID, guestB.Token, guestB.SessionToken, "", "")
	if noProofStatus.StatusCode != http.StatusForbidden {
		t.Errorf("host resume without proof returned %d; want 403", noProofStatus.StatusCode)
	}
	sec02aAssertNoCredentials(t, noProofBody)
}
