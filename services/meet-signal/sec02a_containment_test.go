package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

// SEC-02A fixtures are deliberately still valid unless a case says expired.
// No test emits credentials, request headers, response bodies, or peer frames.
// These tests are serial because the production handlers use package globals.
func sec02aConfigure(t *testing.T, liveKit bool) {
	t.Helper()
	oldManager, oldPrivateKey, oldPublicKey := authManager, hostPrivateKey, hostPublicKeyHex
	oldSessions := sessionManager
	oldHandles := resumeHandles
	oldSecret, oldIssuer, oldTTL := jwtSecret, jwtIssuer, jwtTTL
	oldLKKey, oldLKSecret, oldLKURL, oldLKTTL := liveKitAPIKey, liveKitAPISecret, liveKitURL, liveKitTTL
	oldLogOutput := log.Writer()
	oldTokens := atomic.LoadInt64(&metricTokensIssued)
	oldMessages := atomic.LoadInt64(&metricMessagesRelayed)
	oldErrors := atomic.LoadInt64(&metricSignalErrors)
	t.Cleanup(func() {
		authManager, hostPrivateKey, hostPublicKeyHex = oldManager, oldPrivateKey, oldPublicKey
		sessionManager = oldSessions
		resumeHandles = oldHandles
		jwtSecret, jwtIssuer, jwtTTL = oldSecret, oldIssuer, oldTTL
		liveKitAPIKey, liveKitAPISecret, liveKitURL, liveKitTTL = oldLKKey, oldLKSecret, oldLKURL, oldLKTTL
		atomic.StoreInt64(&metricTokensIssued, oldTokens)
		atomic.StoreInt64(&metricMessagesRelayed, oldMessages)
		atomic.StoreInt64(&metricSignalErrors, oldErrors)
		log.SetOutput(oldLogOutput)
	})
	log.SetOutput(io.Discard)
	authManager = newAuthorityManager()
	sessionManager = newSessionStore()
	resumeHandles = newResumeHandleStore()
	jwtSecret = []byte("sec02a-local-test-legacy-secret-minimum-32-bytes")
	jwtIssuer, jwtTTL = "meet-signal", 5*time.Minute
	liveKitAPIKey, liveKitAPISecret = "sec02a-local-test", ""
	liveKitURL, liveKitTTL = "ws://127.0.0.1:7880", 5*time.Minute
	if liveKit {
		liveKitAPISecret = "sec02a-local-test-livekit-secret-minimum-32-bytes"
	}
	initHostSigning()
}

func sec02aRoom(t *testing.T, roomID, hostID string) RoomAuthority {
	t.Helper()
	if _, err := authManager.createRoom(roomID, hostID); err != nil {
		t.Fatal("fixture room creation failed")
	}
	// Set a fixed future deadline without starting an unrelated expiry goroutine.
	authManager.mu.Lock()
	authManager.rooms[roomID].GraceExpiry = time.Now().Add(time.Hour)
	authManager.mu.Unlock()
	authority, _ := authManager.getAuthority(roomID)
	return *authority
}

func sec02aHostToken(t *testing.T, subject, roomID string) string {
	t.Helper()
	// Bind to the live room instance/generation when the room exists, so the
	// fixture stays valid for SEC-02B/C generation checks; otherwise fall back to
	// a synthetic instance for captured-token fixtures against unknown rooms.
	roomInstanceID := "inst-fixture"
	var generation uint64 = 1
	if auth, ok := authManager.getAuthority(canonicalRoomID(roomID)); ok {
		roomInstanceID = auth.RoomInstanceID
		generation = auth.AuthorityGeneration
	}
	token, err := mintHostToken(subject, roomID, roomInstanceID, generation, 5*time.Minute)
	if err != nil {
		t.Fatal("fixture host signing failed")
	}
	claims, err := validateHostToken(token)
	if err != nil || claims.ParticipantID != subject || claims.RoomID != roomID || claims.Role != "host" ||
		claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) < 4*time.Minute {
		t.Fatal("fixture host token must be correctly signed and still valid")
	}
	return token
}

func sec02aAccessToken(t *testing.T, subject, roomID string, liveKit bool) string {
	t.Helper()
	w := httptest.NewRecorder()
	if liveKit {
		issueLiveKitToken(w, subject, roomID, "Synthetic fixture", "host", "", "", "", "")
	} else {
		issueLegacyToken(w, subject, roomID, "Synthetic fixture", "host", "", "", "", "")
	}
	var result TokenResponse
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != http.StatusOK || result.Token == "" {
		t.Fatal("fixture access token issuance failed")
	}
	claims, err := validateAccessToken(result.Token)
	if err != nil || claims.ParticipantID != subject || claims.Role != "host" ||
		claims.ExpiresAt == nil || time.Until(claims.ExpiresAt.Time) < 4*time.Minute {
		t.Fatal("fixture access token must be correctly signed and still valid")
	}
	return result.Token
}

func sec02aAssertUnchanged(t *testing.T, before RoomAuthority, tokenCount int64) {
	t.Helper()
	after, exists := authManager.getAuthority(before.RoomID)
	if !exists || !reflect.DeepEqual(*after, before) {
		t.Error("denied or participant-only operation changed authority, host grace, or room metadata")
	}
	if atomic.LoadInt64(&metricTokensIssued) != tokenCount {
		t.Error("denied operation changed issued-token counter")
	}
}

func sec02aAssertNoCredentials(t *testing.T, body []byte) {
	t.Helper()
	var result map[string]json.RawMessage
	if json.Unmarshal(body, &result) == nil {
		for _, key := range []string{"token", "livekitToken", "hostToken", "newHostToken"} {
			if raw, present := result[key]; present && string(raw) != `""` && string(raw) != "null" {
				t.Errorf("denied response contains credential field %s", key)
			}
		}
	}
	if strings.Contains(string(body), "eyJ") {
		t.Error("denied response appears to contain a serialized JWT")
	}
}

// sec02aAssertAuthRejected asserts a credential-bearing request failed closed
// with a stable SEC-02B/C error and no credential material.
func sec02aAssertAuthRejected(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	body := strings.TrimSpace(w.Body.String())
	if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden && w.Code != http.StatusBadRequest {
		t.Errorf("credential attempt returned status %d; want 400/401/403 fail-closed", w.Code)
	}
	switch body {
	case "private_session_required", "private_session_invalid", "identity_mismatch",
		"host_proof_required", "resume_handle_invalid", "invalid request":
	default:
		t.Errorf("credential attempt returned unstable error %q", body)
	}
	sec02aAssertNoCredentials(t, w.Body.Bytes())
}

func TestSEC02ATokenCredentialAttemptsFailClosed(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02a-token-room"
			before := sec02aRoom(t, roomID, "p-original")
			original := sec02aHostToken(t, "p-original", roomID)
			capturedB := sec02aHostToken(t, "p-target-b", roomID)
			successorC := sec02aHostToken(t, "p-attacker-c", roomID)
			wrongRoom := sec02aHostToken(t, "p-target-b", "sec02a-other-room")
			expired, err := mintHostToken("p-target-b", roomID, "inst-fixture", 1, -time.Minute)
			if err != nil {
				t.Fatal("expired fixture signing failed")
			}
			legacy := sec02aAccessToken(t, "p-original", roomID, false)
			cases := []struct {
				name   string
				header http.Header
			}{
				{"original_host", http.Header{"Authorization": {"Bearer " + original}}},
				{"captured_B_subject_mismatch", http.Header{"Authorization": {"Bearer " + capturedB}}},
				{"attacker_issued_C", http.Header{"Authorization": {"Bearer " + successorC}}},
				{"legacy_HS256_host", http.Header{"Authorization": {"Bearer " + legacy}}},
				{"wrong_room", http.Header{"Authorization": {"Bearer " + wrongRoom}}},
				{"expired_token", http.Header{"Authorization": {"Bearer " + expired}}},
				{"invalid_signature", http.Header{"Authorization": {"Bearer invalid.jwt.signature"}}},
				{"basic_scheme", http.Header{"Authorization": {"Basic synthetic"}}},
				{"lowercase_bearer", http.Header{"Authorization": {"bearer " + capturedB}}},
				{"missing_bearer_separator", http.Header{"Authorization": {"Bearer"}}},
				{"empty_value", http.Header{"Authorization": {""}}},
				{"whitespace_value", http.Header{"Authorization": {" \t "}}},
				{"duplicate_empty_first", http.Header{"Authorization": {"", "Bearer " + capturedB}}},
				{"duplicate_valid_first", http.Header{"Authorization": {"Bearer " + capturedB, "Basic synthetic"}}},
				{"comma_combined", http.Header{"Authorization": {"Basic synthetic, Bearer " + capturedB}}},
				{"noncanonical_header_key", http.Header{"authorization": {"Bearer " + capturedB}}},
				{"mixedcase_header_key", http.Header{"aUtHoRiZaTiOn": {"Bearer " + capturedB}}},
				{"nil_value_present", http.Header{"Authorization": nil}},
			}
			if liveKit {
				cases = append(cases, struct {
					name   string
					header http.Header
				}{"livekit_HS256_host", http.Header{"Authorization": {"Bearer " + sec02aAccessToken(t, "p-original", roomID, true)}}})
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					count := atomic.LoadInt64(&metricTokensIssued)
					r := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(`{"roomId":"`+roomID+`","name":"Synthetic attacker","participantId":"p-target-b","isCreator":true}`))
					r.Header = tc.header
					w := httptest.NewRecorder()
					handleToken(w, r)
					sec02aAssertAuthRejected(t, w)
					sec02aAssertUnchanged(t, before, count)
					// Reset only the test fixture after a vulnerable-baseline failure so
					// each subsequent case assesses the same independent starting state.
					authManager.mu.Lock()
					copy := before
					authManager.rooms[roomID] = &copy
					authManager.mu.Unlock()
				})
			}
			t.Run("invalid_body_with_credentials_fails_closed", func(t *testing.T) {
				count := atomic.LoadInt64(&metricTokensIssued)
				r := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader("invalid json"))
				r.Header.Set("Authorization", "Bearer "+capturedB)
				w := httptest.NewRecorder()
				handleToken(w, r)
				if w.Code != http.StatusBadRequest {
					t.Errorf("credential attempt with invalid body returned %d; want 400", w.Code)
				}
				sec02aAssertAuthRejected(t, w)
				sec02aAssertUnchanged(t, before, count)
			})
		})
	}
}

func TestSEC02AGuestIssuancePreservesAuthorityAndGrace(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			before := sec02aRoom(t, "sec02a-guest-room", "p-original")
			count := atomic.LoadInt64(&metricTokensIssued)
			r := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(`{"roomId":" SEC02A-GUEST-ROOM ","name":"Synthetic guest","participantId":"p-original","isCreator":true}`))
			w := httptest.NewRecorder()
			handleToken(w, r)
			var response TokenResponse
			if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &response) != nil {
				t.Fatalf("ordinary guest failed with status %d", w.Code)
			}
			if response.Role != "participant" || response.HostToken != "" || response.ParticipantID == "p-original" || response.Token == "" || response.RoomID != before.RoomID {
				t.Error("guest issuance did not retain participant-only, generated identity contract")
			}
			parsed, err := jwt.Parse(response.Token, func(token *jwt.Token) (interface{}, error) {
				if token.Method.Alg() != "HS256" {
					t.Error("guest token algorithm changed unexpectedly")
				}
				if liveKit {
					return []byte(liveKitAPISecret), nil
				}
				return jwtSecret, nil
			})
			if err != nil || !parsed.Valid {
				t.Fatal("guest token failed signature validation")
			}
			claims := parsed.Claims.(jwt.MapClaims)
			if claims["role"] != "participant" || claims["sub"] != response.ParticipantID {
				t.Error("signed guest token does not bind participant role and issued identity")
			}
			if liveKit && (claims["metadata"] != `{"role":"participant"}` || response.LiveKitToken != response.Token) {
				t.Error("LiveKit guest metadata or token response inconsistent")
			}
			sec02aAssertUnchanged(t, before, count+1)
		})
	}
}

func TestSEC02ARoleLookupCannotClearGraceOrReassignHost(t *testing.T) {
	sec02aConfigure(t, false)
	before := sec02aRoom(t, "sec02a-lookup-room", "p-original")
	for _, identity := range []string{"p-original", "p-attacker"} {
		role, created := authManager.assignRole(before.RoomID, identity)
		want := "participant"
		if identity == "p-original" {
			want = "host"
		}
		if role != want || created {
			t.Error("existing-room role lookup returned unexpected role or creation result")
		}
		sec02aAssertUnchanged(t, before, atomic.LoadInt64(&metricTokensIssued))
	}
	if method := reflect.TypeOf(authManager.assignRole); method.IsVariadic() || method.NumIn() != 2 {
		t.Error("role lookup still accepts an authorization override argument")
	}
	role, _ := authManager.assignRole("sec02a-uncreated-room", "p-attacker")
	authority, exists := authManager.getAuthority("sec02a-uncreated-room")
	if role != "participant" || !exists || authority.HostID != "" {
		t.Error("uncreated room guest must remain unhosted")
	}
}

// Actual signal connections use server-signed signaling credentials. The test
// sends a server-side barrier after the synchronous transfer handler returns;
// each peer must receive the barrier as its next frame. This proves absence of
// transfer/credential frames when the requester lacks a private session.
func TestSEC02ATransferWithoutSessionRejectedAcrossThreePeers(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			roomID := "sec02a-three-peers"
			before := sec02aRoom(t, roomID, "p-target-b")
			h := newHub()
			var handlers sync.WaitGroup
			mux := http.NewServeMux()
			mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
				handlers.Add(1)
				defer handlers.Done()
				handleSignal(h, w, r)
			})
			mux.HandleFunc("/room/transfer-host", func(w http.ResponseWriter, r *http.Request) { handleTransferHost(h, authManager, w, r) })
			server := httptest.NewServer(mux)
			var connections []*websocket.Conn
			t.Cleanup(func() {
				for _, connection := range connections {
					connection.Close()
				}
				server.Close()
				handlers.Wait()
			})
			for index, participant := range []string{"p-original", "p-target-b", "p-observer-x"} {
				header := http.Header{"Authorization": {"Bearer " + sec02aAccessToken(t, participant, roomID, false)}}
				connection, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/signal?room="+roomID, header)
				if err != nil {
					if response != nil {
						response.Body.Close()
					}
					t.Fatal("fixture WebSocket connection failed")
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
			capturedB := sec02aHostToken(t, "p-target-b", roomID)
			count := atomic.LoadInt64(&metricTokensIssued)
			r, _ := http.NewRequest(http.MethodPost, server.URL+"/room/transfer-host", strings.NewReader(`{"roomId":"`+roomID+`","targetParticipantId":"p-observer-x"}`))
			r.Header.Set("Authorization", "Bearer "+capturedB)
			response, err := server.Client().Do(r)
			if err != nil {
				t.Fatal("transfer HTTP request failed")
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil {
				t.Fatal("transfer HTTP response read failed")
			}
			if response.StatusCode != http.StatusUnauthorized {
				t.Errorf("transfer without private session returned %d; want 401", response.StatusCode)
			}
			sec02aAssertNoCredentials(t, body)
			sec02aAssertUnchanged(t, before, count)
			peers := h.peers(roomID, nil)
			if len(peers) != 3 {
				t.Fatalf("fixture has %d peers; want three", len(peers))
			}
			for _, peer := range peers {
				if peer.writeJSON(SignalMessage{Type: "sec02a-barrier"}) != nil {
					t.Fatal("failed to write peer barrier")
				}
			}
			for index, peer := range connections {
				peer.SetReadDeadline(time.Now().Add(3 * time.Second))
				for {
					var frame SignalMessage
					if peer.ReadJSON(&frame) != nil {
						t.Fatal("failed to receive peer barrier")
					}
					if frame.Type == "sec02a-barrier" {
						break
					}
					t.Errorf("peer %d received a transfer frame while transfer must be disabled", index)
					sec02aAssertNoCredentials(t, frame.Payload)
				}
			}
		})
	}
}

func TestSEC02ATransferRejectsInvalidCredentials(t *testing.T) {
	sec02aConfigure(t, false)
	before := sec02aRoom(t, "sec02a-gate-room", "p-original")
	original := sec02aHostToken(t, "p-original", before.RoomID)
	successorC := sec02aHostToken(t, "p-attacker-c", before.RoomID)
	for _, tc := range []struct{ name, authorization, body string }{
		{"original_host_invalid_body", "Bearer " + original, "invalid json"},
		{"attacker_issued_C", "Bearer " + successorC, `{"roomId":"sec02a-gate-room","targetParticipantId":"p-target"}`},
		{"missing_credentials", "", `{"roomId":"sec02a-gate-room","targetParticipantId":"p-target"}`},
		{"malformed_credential_and_body", "Basic synthetic", "invalid json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			count := atomic.LoadInt64(&metricTokensIssued)
			r := httptest.NewRequest(http.MethodPost, "/room/transfer-host", strings.NewReader(tc.body))
			if tc.authorization != "" {
				r.Header.Set("Authorization", tc.authorization)
			}
			w := httptest.NewRecorder()
			handleTransferHost(newHub(), authManager, w, r)
			sec02aAssertAuthRejected(t, w)
			sec02aAssertUnchanged(t, before, count)
		})
	}
}

func TestSEC02AConcurrentTransferAndResumeRemainContained(t *testing.T) {
	for _, liveKit := range []bool{false, true} {
		mode := "legacy"
		if liveKit {
			mode = "livekit"
		}
		t.Run(mode, func(t *testing.T) {
			sec02aConfigure(t, liveKit)
			before := sec02aRoom(t, "sec02a-concurrent-room", "p-original")
			capturedB := sec02aHostToken(t, "p-target-b", before.RoomID)
			count := atomic.LoadInt64(&metricTokensIssued)
			start := make(chan struct{})
			var workers sync.WaitGroup
			for i := 0; i < 32; i++ {
				transfer := i%2 == 0
				workers.Add(1)
				go func() {
					defer workers.Done()
					r := httptest.NewRequest(http.MethodPost, "/token", strings.NewReader(`{"roomId":"sec02a-concurrent-room","name":"Synthetic attacker","targetParticipantId":"p-attacker"}`))
					r.Header.Set("Authorization", "Bearer "+capturedB)
					w := httptest.NewRecorder()
					<-start
					if transfer {
						handleTransferHost(newHub(), authManager, w, r)
						if w.Code != http.StatusUnauthorized {
							t.Errorf("concurrent transfer returned %d; want 401", w.Code)
						}
					} else {
						handleToken(w, r)
						if w.Code != http.StatusUnauthorized {
							t.Errorf("concurrent resume returned %d; want 401", w.Code)
						}
					}
					sec02aAssertNoCredentials(t, w.Body.Bytes())
				}()
			}
			close(start)
			workers.Wait()
			sec02aAssertUnchanged(t, before, count)
		})
	}
}

func TestSEC02ANonPOSTMethodsRemainRejected(t *testing.T) {
	sec02aConfigure(t, false)
	before := sec02aRoom(t, "sec02a-method-room", "p-original")
	count := atomic.LoadInt64(&metricTokensIssued)
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions} {
		for _, transfer := range []bool{false, true} {
			r := httptest.NewRequest(method, "/token", strings.NewReader("invalid json"))
			r.Header.Set("Authorization", "Basic synthetic")
			w := httptest.NewRecorder()
			if transfer {
				handleTransferHost(newHub(), authManager, w, r)
			} else {
				handleToken(w, r)
			}
			if w.Code != http.StatusMethodNotAllowed {
				t.Errorf("unsupported %s method returned %d; want 405", method, w.Code)
			}
			sec02aAssertNoCredentials(t, w.Body.Bytes())
		}
	}
	sec02aAssertUnchanged(t, before, count)
}
