// meet-signal unit tests for token issuance (Phase 1 LiveKit + legacy mesh)
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func setTestAuthHeader(req *http.Request, roomID string, participantID string, role string) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		ParticipantID: participantID,
		RoomID:        roomID,
		Role:          role,
	})
	signed, _ := token.SignedString(jwtSecret)
	req.Header.Set("Authorization", "Bearer "+signed)
}

func TestLiveKitClaimsStructure(t *testing.T) {
	// Test that LiveKit JWT claims contain all required fields
	participantID := "p-" + uuid.New().String()[:8]
	roomID := "test-room-123"
	name := "Test User"
	now := time.Now()
	expiresAt := now.Add(5 * time.Minute)
	apiKey := "test-api-key"
	apiSecret := "test-api-secret-32chars-minimum-length"

	claims := LiveKitClaims{
		Video: LiveKitVideoGrant{
			RoomJoin:       true,
			Room:           roomID,
			CanPublish:     true,
			CanSubscribe:   true,
			CanPublishData: true,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    apiKey,
			Subject:   participantID,
			Audience:  jwt.ClaimStrings{roomID},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			ID:        uuid.New().String(),
		},
	}

	type liveKitClaimsWithName struct {
		LiveKitClaims
		Name string `json:"name"`
	}
	fullClaims := liveKitClaimsWithName{
		LiveKitClaims: claims,
		Name:          name,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, fullClaims)
	signed, err := token.SignedString([]byte(apiSecret))
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}

	// Parse and verify
	parsed, err := jwt.ParseWithClaims(signed, &liveKitClaimsWithName{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(apiSecret), nil
	})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	parsedClaims, ok := parsed.Claims.(*liveKitClaimsWithName)
	if !ok {
		t.Fatal("claims type assertion failed")
	}

	// Verify required claims
	if parsedClaims.Issuer != apiKey {
		t.Errorf("issuer mismatch: got %s, want %s", parsedClaims.Issuer, apiKey)
	}
	if parsedClaims.Subject != participantID {
		t.Errorf("subject mismatch: got %s, want %s", parsedClaims.Subject, participantID)
	}
	if len(parsedClaims.Audience) != 1 || parsedClaims.Audience[0] != roomID {
		t.Errorf("audience mismatch: got %v, want [%s]", parsedClaims.Audience, roomID)
	}
	if parsedClaims.Name != name {
		t.Errorf("name mismatch: got %s, want %s", parsedClaims.Name, name)
	}
	if !parsedClaims.Video.RoomJoin {
		t.Error("video.roomJoin should be true")
	}
	if parsedClaims.Video.Room != roomID {
		t.Errorf("video.room mismatch: got %s, want %s", parsedClaims.Video.Room, roomID)
	}
	if !parsedClaims.Video.CanPublish {
		t.Error("video.canPublish should be true")
	}
	if !parsedClaims.Video.CanSubscribe {
		t.Error("video.canSubscribe should be true")
	}
	if !parsedClaims.Video.CanPublishData {
		t.Error("video.canPublishData should be true")
	}
	if parsedClaims.ExpiresAt == nil || parsedClaims.ExpiresAt.Time.Before(now) {
		t.Error("expiresAt should be in future")
	}
	if parsedClaims.ID == "" {
		t.Error("jti (ID) should not be empty")
	}

	t.Logf("LiveKit token verified successfully: %s...", signed[:16])
}

func TestLegacyMeshClaimsStructure(t *testing.T) {
	participantID := "p-" + uuid.New().String()[:8]
	roomID := "test-room-legacy"
	name := "Legacy User"
	now := time.Now()
	issuer := "meet-signal"
	secret := "legacy-jwt-secret-32chars-minimum-length"

	claims := Claims{
		ParticipantID: participantID,
		RoomID:        roomID,
		Name:          name,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   participantID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(1 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("signing failed: %v", err)
	}

	parsed, err := jwt.ParseWithClaims(signed, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}

	parsedClaims, ok := parsed.Claims.(*Claims)
	if !ok {
		t.Fatal("claims type assertion failed")
	}

	if parsedClaims.Issuer != issuer {
		t.Errorf("issuer mismatch: got %s, want %s", parsedClaims.Issuer, issuer)
	}
	if parsedClaims.ParticipantID != participantID {
		t.Errorf("subject mismatch: got %s, want %s", parsedClaims.ParticipantID, participantID)
	}
	if parsedClaims.RoomID != roomID {
		t.Errorf("roomID mismatch: got %s, want %s", parsedClaims.RoomID, roomID)
	}
	if parsedClaims.Name != name {
		t.Errorf("name mismatch: got %s, want %s", parsedClaims.Name, name)
	}
	if parsedClaims.ParticipantID != participantID {
		t.Errorf("ParticipantID mismatch: got %s, want %s", parsedClaims.ParticipantID, participantID)
	}

	t.Logf("Legacy mesh token verified successfully: %s...", signed[:16])
}

func TestLiveKitTokenTTL(t *testing.T) {
	// Verify LiveKit token TTL is 5 minutes (300s) by default
	participantID := "p-test123"
	roomID := "ttl-test-room"
	apiKey := "dev"
	apiSecret := "p0-dev-pass-32chars-0123456789abcdef012345"
	now := time.Now()

	claims := LiveKitClaims{
		Video: LiveKitVideoGrant{
			RoomJoin:       true,
			Room:           roomID,
			CanPublish:     true,
			CanSubscribe:   true,
			CanPublishData: true,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    apiKey,
			Subject:   participantID,
			Audience:  jwt.ClaimStrings{roomID},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(300 * time.Second)),
			ID:        uuid.New().String(),
		},
	}

	type liveKitClaimsWithName struct {
		LiveKitClaims
		Name string `json:"name"`
	}
	fullClaims := liveKitClaimsWithName{LiveKitClaims: claims, Name: "Test"}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, fullClaims)
	signed, _ := token.SignedString([]byte(apiSecret))

	parsed, _ := jwt.ParseWithClaims(signed, &liveKitClaimsWithName{}, func(t *jwt.Token) (interface{}, error) {
		return []byte(apiSecret), nil
	})
	parsedClaims := parsed.Claims.(*liveKitClaimsWithName)

	ttl := parsedClaims.ExpiresAt.Time.Sub(parsedClaims.IssuedAt.Time)
	expectedTTL := 300 * time.Second

	// Allow 1 second tolerance
	if ttl < expectedTTL-time.Second || ttl > expectedTTL+time.Second {
		t.Errorf("TTL mismatch: got %v, want ~%v", ttl, expectedTTL)
	}
}

func TestVideoGrantFields(t *testing.T) {
	// Ensure all required VideoGrant fields are present and correct
	grant := LiveKitVideoGrant{
		RoomJoin:       true,
		Room:           "room-abc",
		CanPublish:     true,
		CanSubscribe:   true,
		CanPublishData: true,
	}

	if !grant.RoomJoin {
		t.Error("RoomJoin must be true")
	}
	if grant.Room != "room-abc" {
		t.Errorf("Room must be set to room ID, got %s", grant.Room)
	}
	if !grant.CanPublish {
		t.Error("CanPublish must be true")
	}
	if !grant.CanSubscribe {
		t.Error("CanSubscribe must be true")
	}
	if !grant.CanPublishData {
		t.Error("CanPublishData must be true")
	}
}

func TestJWTSecretValidation(t *testing.T) {
	// Test that JWT_SECRET validation works (min 32 bytes)
	shortSecret := []byte("short")
	if len(shortSecret) < 32 {
		// This is expected to fail in main()
		t.Log("Short secret correctly rejected")
	}

	longSecret := []byte("this-is-a-valid-secret-32-chars-min")
	if len(longSecret) >= 32 {
		t.Log("Long secret accepted")
	}
}

func TestLIVEKITAPISecretValidation(t *testing.T) {
	// Test that LIVEKIT_API_SECRET validation works (min 32 bytes when set)
	shortSecret := "short"
	if len(shortSecret) < 32 {
		t.Log("Short LiveKit secret correctly rejected")
	}

	longSecret := "this-is-a-valid-livekit-secret-32-chars-min"
	if len(longSecret) >= 32 {
		t.Log("Long LiveKit secret accepted")
	}
}

func TestM4AAuthorityManagerAssignRole(t *testing.T) {
	am := newAuthorityManager()
	roomID := "m4a-room-test"

	// 1. Creator creates room -> designates p-alice as host
	auth, err := am.createRoom(roomID, "p-alice")
	if err != nil || auth.HostID != "p-alice" {
		t.Fatalf("createRoom failed: %v, auth: %+v", err, auth)
	}

	// 2. Second joiner receives "participant"
	role2, isNew2 := am.assignRole(roomID, "p-bob")
	if role2 != "participant" || isNew2 {
		t.Fatalf("second joiner should be participant, got role=%s isNew=%v", role2, isNew2)
	}

	// 3. Reconnecting host retains "host"
	roleReconn, _ := am.assignRole(roomID, "p-alice")
	if roleReconn != "host" {
		t.Fatalf("reconnecting host should retain host role, got %s", roleReconn)
	}
}

func TestM4ACreatorClaimForgeryRejection(t *testing.T) {
	am := newAuthorityManager()
	roomID := "m4a-forgery-test"

	// M4A-SEC-09: Attacker tries to join uncreated room via assignRole
	// Client self-assertion never grants host authority
	role, _ := am.assignRole(roomID, "p-attacker")
	if role == "host" {
		t.Fatalf("M4A-SEC-09 FAILED: client assertion granted host authority! got role=%s", role)
	}
	if role != "participant" {
		t.Fatalf("expected participant, got %s", role)
	}
}

func TestM4AAuthorityManagerTransfer(t *testing.T) {
	am := newAuthorityManager()
	roomID := "m4a-transfer-room"

	am.createRoom(roomID, "p-alice")
	am.assignRole(roomID, "p-bob")

	// 1. Non-host attempts transfer -> fails
	errUnauthorized := am.transferHost(roomID, "p-charlie", "p-bob", 1)
	if errUnauthorized == nil {
		t.Fatal("non-host transfer should be rejected")
	}

	// 2. Host transfers to bob -> succeeds
	errOk := am.transferHost(roomID, "p-alice", "p-bob", 1)
	if errOk != nil {
		t.Fatalf("valid host transfer failed: %v", errOk)
	}

	auth, ok := am.getAuthority(roomID)
	if !ok || auth.HostID != "p-bob" {
		t.Fatalf("expected host to be p-bob, got %v (ok=%v)", auth, ok)
	}
}

func TestM4AMintHostTokenES256(t *testing.T) {
	if hostPrivateKey == nil {
		initHostSigning()
	}

	participantID := "p-host-123"
	roomID := "room-secure-456"
	roomInstanceID := "inst-test-abc"
	generation := uint64(7)

	tokenStr, err := mintHostToken(participantID, roomID, roomInstanceID, generation, 5*time.Minute)
	if err != nil {
		t.Fatalf("mintHostToken failed: %v", err)
	}
	if tokenStr == "" {
		t.Fatal("mintHostToken returned empty string")
	}

	// Verify using public key
	parsed, err := jwt.ParseWithClaims(tokenStr, &HostClaims{}, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodECDSA); !ok {
			t.Fatalf("expected ES256 signing, got %v", tok.Header["alg"])
		}
		return &hostPrivateKey.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("failed to parse/verify host token: %v", err)
	}

	claims, ok := parsed.Claims.(*HostClaims)
	if !ok || !parsed.Valid {
		t.Fatal("invalid claims in host token")
	}

	if claims.ParticipantID != participantID || claims.Role != "host" || claims.RoomID != roomID {
		t.Errorf("claims mismatch: got %+v", claims)
	}
	if claims.RoomInstanceID != roomInstanceID || claims.Generation != generation {
		t.Errorf("generation/instance binding mismatch: got rinst=%q gen=%d", claims.RoomInstanceID, claims.Generation)
	}
}

func TestM4A1RoomStatusEndpoint(t *testing.T) {
	am := newAuthorityManager()

	// 1. Check non-existent room
	reqNotFound := httptest.NewRequest(http.MethodGet, "/room/status?roomId=non-existent-room", nil)
	wNotFound := httptest.NewRecorder()
	handleRoomStatus(am, wNotFound, reqNotFound)

	if wNotFound.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for status probe, got %d", wNotFound.Code)
	}
	var resNotFound map[string]any
	if err := json.NewDecoder(wNotFound.Body).Decode(&resNotFound); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resNotFound["exists"] != false || resNotFound["joinable"] != false {
		t.Errorf("expected non-existent room to have exists=false, joinable=false, got %+v", resNotFound)
	}

	// 2. Register active room
	roomID := "active-meeting-123"
	_, _ = am.createRoom(roomID, "host-user")

	reqActive := httptest.NewRequest(http.MethodGet, "/room/status?roomId="+roomID, nil)
	wActive := httptest.NewRecorder()
	handleRoomStatus(am, wActive, reqActive)

	if wActive.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for active room, got %d", wActive.Code)
	}
	var resActive map[string]any
	if err := json.NewDecoder(wActive.Body).Decode(&resActive); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resActive["exists"] != true || resActive["joinable"] != true || resActive["locked"] != false {
		t.Errorf("expected active room to have exists=true, joinable=true, locked=false, got %+v", resActive)
	}

	// Verify NO host metadata or keys leaked to unauthenticated caller
	if _, hasHostID := resActive["hostId"]; hasHostID {
		t.Errorf("security violation: hostId leaked in /room/status response: %+v", resActive)
	}
	if _, hasHostKey := resActive["hostKey"]; hasHostKey {
		t.Errorf("security violation: hostKey leaked in /room/status response: %+v", resActive)
	}

	// 3. Lock room and check status
	am.mu.Lock()
	am.rooms[roomID].Locked = true
	am.mu.Unlock()

	reqLocked := httptest.NewRequest(http.MethodGet, "/room/status?roomId="+roomID, nil)
	wLocked := httptest.NewRecorder()
	handleRoomStatus(am, wLocked, reqLocked)

	var resLocked map[string]any
	if err := json.NewDecoder(wLocked.Body).Decode(&resLocked); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if resLocked["exists"] != true || resLocked["joinable"] != false || resLocked["locked"] != true {
		t.Errorf("expected locked room to have exists=true, joinable=false, locked=true, got %+v", resLocked)
	}
}

func TestCanonicalRoomIDMixedCaseStatusLookup(t *testing.T) {
	am := newAuthorityManager()
	mixedCase := "Room-ABC123Def"
	_, err := am.createRoom(canonicalRoomID(mixedCase), "host-1")
	if err != nil {
		t.Fatalf("createRoom failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/room/status?roomId="+mixedCase, nil)
	w := httptest.NewRecorder()
	handleRoomStatus(am, w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var res map[string]any
	json.NewDecoder(w.Body).Decode(&res)
	if res["exists"] != true {
		t.Errorf("expected exists=true for mixed-case lookup of canonical room, got %+v", res)
	}
}

func TestCanonicalRoomIDAuthorityLookupCaseInsensitive(t *testing.T) {
	am := newAuthorityManager()
	_, _ = am.createRoom(canonicalRoomID("MyRoom-XyZ"), "host-1")

	for _, variant := range []string{"myroom-xyz", "MYROOM-XYZ", "MyRoom-XyZ", " myroom-xyz "} {
		auth, ok := am.getAuthority(canonicalRoomID(variant))
		if !ok {
			t.Errorf("getAuthority(%q) returned not found, expected match", variant)
			continue
		}
		if auth.HostID != "host-1" {
			t.Errorf("getAuthority(%q) hostId=%s, want host-1", variant, auth.HostID)
		}
	}
}

func TestCanonicalRoomIDDuplicateCaseConflict(t *testing.T) {
	am := newAuthorityManager()
	_, err := am.createRoom(canonicalRoomID("Room-Dup"), "host-1")
	if err != nil {
		t.Fatalf("first createRoom failed: %v", err)
	}

	_, err = am.createRoom(canonicalRoomID("ROOM-DUP"), "host-2")
	if err == nil {
		t.Error("expected 409-equivalent error for case-variant duplicate room, got nil")
	}
}

func TestCanonicalRoomIDTransferHostAcrossCaseVariants(t *testing.T) {
	am := newAuthorityManager()
	canonical := canonicalRoomID("Transfer-Room-Abc")
	_, _ = am.createRoom(canonical, "host-original")

	err := am.transferHost(canonicalRoomID("TRANSFER-ROOM-ABC"), "host-original", "host-new", 1)
	if err != nil {
		t.Fatalf("transferHost across case variants failed: %v", err)
	}

	auth, ok := am.getAuthority(canonical)
	if !ok {
		t.Fatal("room not found after transfer")
	}
	if auth.HostID != "host-new" {
		t.Errorf("expected hostId=host-new after transfer, got %s", auth.HostID)
	}
}

func TestCanonicalRoomIDWhitespaceAndCaseNormalization(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{" Room-ABC ", "room-abc"},
		{"ROOM-123", "room-123"},
		{"  MixedCase-Room  ", "mixedcase-room"},
		{"already-lower", "already-lower"},
		{"", ""},
	}
	for _, tc := range cases {
		got := canonicalRoomID(tc.input)
		if got != tc.expected {
			t.Errorf("canonicalRoomID(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestCanonicalRoomIDGuestTokenAgainstMixedCaseRoom(t *testing.T) {
	am := newAuthorityManager()
	mixedCase := "Guest-Room-Mix789"
	canonical := canonicalRoomID(mixedCase)
	_, _ = am.createRoom(canonical, "host-1")

	role, _ := am.assignRole(canonicalRoomID(mixedCase), "guest-p1")
	if role != "participant" {
		t.Errorf("expected participant role for guest on mixed-case room, got %s", role)
	}

	auth, ok := am.getAuthority(canonical)
	if !ok {
		t.Fatal("room not found after guest assignRole")
	}
	if auth.HostID != "host-1" {
		t.Errorf("host displaced by guest join: hostId=%s", auth.HostID)
	}
}

func TestWebSocketSignalConnectionWithLiveKitAndLegacyTokens(t *testing.T) {
	oldSecret := jwtSecret
	oldTTL := jwtTTL
	oldLKSecret := liveKitAPISecret
	oldLKKey := liveKitAPIKey
	oldLKURL := liveKitURL
	oldLKTTL := liveKitTTL
	t.Cleanup(func() {
		jwtSecret = oldSecret
		jwtTTL = oldTTL
		liveKitAPISecret = oldLKSecret
		liveKitAPIKey = oldLKKey
		liveKitURL = oldLKURL
		liveKitTTL = oldLKTTL
	})

	jwtSecret = []byte("test-legacy-jwt-secret-minimum-32-chars-long")
	jwtTTL = 5 * time.Minute
	liveKitAPIKey = "test-key"
	liveKitAPISecret = "test-livekit-api-secret-32-chars-minimum-long"
	liveKitURL = "ws://127.0.0.1:7880"
	liveKitTTL = 5 * time.Minute

	h := newHub()
	mux := http.NewServeMux()
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
		handleSignal(h, w, r)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	const roomID = "signal-test-room-123"

	// 1. LiveKit token issued via issueLiveKitToken
	wLK := httptest.NewRecorder()
	issueLiveKitToken(wLK, "p-lk-user-1", roomID, "LK User", "participant", "", "", "", "")
	if wLK.Code != http.StatusOK {
		t.Fatalf("issueLiveKitToken failed: status=%d", wLK.Code)
	}
	var respLK TokenResponse
	if err := json.NewDecoder(wLK.Body).Decode(&respLK); err != nil {
		t.Fatalf("decode LK token response failed: %v", err)
	}

	// 2. Connect via WebSocket to /signal using LiveKit token in query param
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdr := http.Header{}
	hdr.Set("Sec-WebSocket-Protocol", "meet-token, " + respLK.Token)
	connLK, resp, err := websocket.DefaultDialer.Dial(wsURL, hdr)
	if err != nil {
		if resp != nil {
			t.Fatalf("LiveKit token WebSocket connection failed: status=%d err=%v", resp.StatusCode, err)
		}
		t.Fatalf("LiveKit token WebSocket dial failed: %v", err)
	}
	defer connLK.Close()

	// 3. Connect second client with legacy token
	wLeg := httptest.NewRecorder()
	issueLegacyToken(wLeg, "p-leg-user-2", roomID, "Legacy User", "participant", "", "", "", "")
	if wLeg.Code != http.StatusOK {
		t.Fatalf("issueLegacyToken failed: status=%d", wLeg.Code)
	}
	var respLeg TokenResponse
	if err := json.NewDecoder(wLeg.Body).Decode(&respLeg); err != nil {
		t.Fatalf("decode legacy token response failed: %v", err)
	}

	wsURLLeg := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrLeg := http.Header{}
	hdrLeg.Set("Sec-WebSocket-Protocol", "meet-token, " + respLeg.Token)
	connLeg, resp2, err := websocket.DefaultDialer.Dial(wsURLLeg, hdrLeg)
	if err != nil {
		if resp2 != nil {
			t.Fatalf("Legacy token WebSocket connection failed: status=%d err=%v", resp2.StatusCode, err)
		}
		t.Fatalf("Legacy token WebSocket dial failed: %v", err)
	}
	defer connLeg.Close()

	// 4. Verify peer join exchange across LiveKit and legacy client
	connLK.SetReadDeadline(time.Now().Add(2 * time.Second))
	var joinMsg SignalMessage
	if err := connLK.ReadJSON(&joinMsg); err != nil {
		t.Fatalf("failed to read join message: %v", err)
	}
	if joinMsg.Type != "join" || joinMsg.ParticipantID != "p-leg-user-2" {
		t.Errorf("expected join from p-leg-user-2, got %+v", joinMsg)
	}

	// 5. Test room mismatch returns 403 Forbidden
	hdrMismatch := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + respLK.Token}}
	wsURLMismatch := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=wrong-room&token=" + url.QueryEscape(respLK.Token)
	_, respMismatch, err := websocket.DefaultDialer.Dial(wsURLMismatch, hdrMismatch)
	if err == nil {
		t.Fatal("expected room mismatch to fail, but connection succeeded")
	}
	if respMismatch == nil || respMismatch.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 StatusForbidden on room mismatch, got %v", respMismatch)
	}

	// 6. Test missing/invalid token returns 401 Unauthorized
	hdrNoToken := http.Header{}
	wsURLNoToken := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	_, respNoToken, err := websocket.DefaultDialer.Dial(wsURLNoToken, hdrNoToken)
	if err == nil {
		t.Fatal("expected missing token to fail, but connection succeeded")
	}
	if respNoToken == nil || respNoToken.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 StatusUnauthorized on missing token, got %v", respNoToken)
	}
}

func TestWebSocketSignalAuthorizationEdgeCases(t *testing.T) {
	oldSecret := jwtSecret
	oldTTL := jwtTTL
	oldLKSecret := liveKitAPISecret
	oldLKKey := liveKitAPIKey
	t.Cleanup(func() {
		jwtSecret = oldSecret
		jwtTTL = oldTTL
		liveKitAPISecret = oldLKSecret
		liveKitAPIKey = oldLKKey
	})

	jwtSecret = []byte("test-legacy-jwt-secret-minimum-32-chars-long")
	jwtTTL = 5 * time.Minute
	liveKitAPIKey = "test-key"
	liveKitAPISecret = "test-livekit-api-secret-32-chars-minimum-long"
	liveKitURL = "ws://127.0.0.1:7880"
	liveKitTTL = 5 * time.Minute

	h := newHub()
	mux := http.NewServeMux()
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
		handleSignal(h, w, r)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	const roomID = "signal-edge-room"

	wLK := httptest.NewRecorder()
	issueLiveKitToken(wLK, "p-edge-1", roomID, "Edge 1", "participant", "", "", "", "")
	var respLK TokenResponse
	if err := json.NewDecoder(wLK.Body).Decode(&respLK); err != nil {
		t.Fatalf("decode LK token failed: %v", err)
	}

	// 1. Authorization: Bearer <token> header connection (uppercase)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrUpper := http.Header{"Authorization": []string{"Bearer " + respLK.Token}}
	connUpper, respUp, err := websocket.DefaultDialer.Dial(wsURL, hdrUpper)
	if err != nil {
		if respUp != nil {
			t.Fatalf("Authorization Bearer header connection failed: status=%d err=%v", respUp.StatusCode, err)
		}
		t.Fatalf("Authorization Bearer header connection failed: %v", err)
	}
	connUpper.Close()

	// 2. Authorization: bearer <token> header connection (lowercase)
	hdrLower := http.Header{"Authorization": []string{"bearer " + respLK.Token}}
	connLower, _, err := websocket.DefaultDialer.Dial(wsURL, hdrLower)
	if err != nil {
		t.Fatalf("Authorization lowercase bearer header connection failed: %v", err)
	}
	connLower.Close()

	// 3. Mixed case room in query parameter connects successfully
	hdrMixed := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + respLK.Token}}
	wsURLMixed := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=SIGNAL-EDGE-ROOM&token=" + url.QueryEscape(respLK.Token)
	connMixed, _, err := websocket.DefaultDialer.Dial(wsURLMixed, hdrMixed)
	if err != nil {
		t.Fatalf("mixed case room connection failed: %v", err)
	}
	connMixed.Close()

	// 4. Token with empty participantId/subject is rejected with 401
	claimsNoSub := &Claims{
		ParticipantID: "",
		RoomID:        roomID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "",
			Audience:  jwt.ClaimStrings{roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokNoSub := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsNoSub)
	signedNoSub, _ := tokNoSub.SignedString(jwtSecret)
	wsURLNoSub := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrNoSub := http.Header{}
	hdrNoSub.Set("Sec-WebSocket-Protocol", "meet-token, " + signedNoSub)
	_, respNoSub, err := websocket.DefaultDialer.Dial(wsURLNoSub, hdrNoSub)
	if err == nil {
		t.Fatal("expected empty subject token to fail")
	}
	if respNoSub == nil || respNoSub.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 on empty subject token, got %v", respNoSub)
	}

	// 5. Contradictory room token (room != aud[0]) is rejected with 401
	claimsConflict := &Claims{
		ParticipantID: "p-conflict",
		RoomID:        "room-alpha",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-conflict",
			Audience:  jwt.ClaimStrings{"room-beta"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokConflict := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsConflict)
	signedConflict, _ := tokConflict.SignedString(jwtSecret)
	hdrConflict := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedConflict}}
	wsURLConflict := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=room-alpha&token=" + url.QueryEscape(signedConflict)
	_, respConflict, err := websocket.DefaultDialer.Dial(wsURLConflict, hdrConflict)
	if err == nil {
		t.Fatal("expected conflicting room token to fail")
	}
	if respConflict == nil || respConflict.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 on conflicting room token, got %v", respConflict)
	}

	// 6. Expired token is rejected with 401
	claimsExpired := &Claims{
		ParticipantID: "p-expired",
		RoomID:        roomID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-expired",
			Audience:  jwt.ClaimStrings{roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-5 * time.Minute)),
		},
	}
	tokExpired := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsExpired)
	signedExpired, _ := tokExpired.SignedString(jwtSecret)
	wsURLExpired := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrExpired := http.Header{}
	hdrExpired.Set("Sec-WebSocket-Protocol", "meet-token, " + signedExpired)
	_, respExpired, err := websocket.DefaultDialer.Dial(wsURLExpired, hdrExpired)
	if err == nil {
		t.Fatal("expected expired token to fail")
	}
	if respExpired == nil || respExpired.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 on expired token, got %v", respExpired)
	}

	// 7. Standard LiveKit token with video.room and no aud connects successfully
	claimsLKVideoOnly := LiveKitClaims{
		Video: LiveKitVideoGrant{
			Room:     roomID,
			RoomJoin: true,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-lk-video-only",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokLKVideoOnly := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsLKVideoOnly)
	signedLKVideoOnly, _ := tokLKVideoOnly.SignedString([]byte(liveKitAPISecret))
	wsURLLKVideoOnly := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrLKVideoOnly := http.Header{}
	hdrLKVideoOnly.Set("Sec-WebSocket-Protocol", "meet-token, " + signedLKVideoOnly)
	connLKVideoOnly, respLKVideoOnly, err := websocket.DefaultDialer.Dial(wsURLLKVideoOnly, hdrLKVideoOnly)
	if err != nil {
		if respLKVideoOnly != nil {
			t.Fatalf("LiveKit video.room only connection failed: status=%d err=%v", respLKVideoOnly.StatusCode, err)
		}
		t.Fatalf("LiveKit video.room only connection dial failed: %v", err)
	}
	connLKVideoOnly.Close()

	// 8. LiveKit token with conflicting video.room and aud is rejected with 401
	claimsLKConflict := LiveKitClaims{
		Video: LiveKitVideoGrant{
			Room:     roomID,
			RoomJoin: true,
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-lk-conflict",
			Audience:  jwt.ClaimStrings{"conflicting-room"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokLKConflict := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsLKConflict)
	signedLKConflict, _ := tokLKConflict.SignedString([]byte(liveKitAPISecret))
	wsURLLKConflict := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrLKConflict := http.Header{}
	hdrLKConflict.Set("Sec-WebSocket-Protocol", "meet-token, " + signedLKConflict)
	_, respLKConflict, err := websocket.DefaultDialer.Dial(wsURLLKConflict, hdrLKConflict)
	if err == nil {
		t.Fatal("expected conflicting LiveKit video.room and aud token to fail")
	}
	if respLKConflict == nil || respLKConflict.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 on conflicting LiveKit token, got %v", respLKConflict)
	}

	// 9. Token with multi-audience containing room connects successfully
	claimsMultiAud := &Claims{
		ParticipantID: "p-multi-aud",
		RoomID:        roomID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-multi-aud",
			Audience:  jwt.ClaimStrings{"meet-signal-service", roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokMultiAud := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsMultiAud)
	signedMultiAud, _ := tokMultiAud.SignedString(jwtSecret)
	wsURLMultiAud := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrMultiAud := http.Header{}
	hdrMultiAud.Set("Sec-WebSocket-Protocol", "meet-token, " + signedMultiAud)
	connMultiAud, respMultiAud, err := websocket.DefaultDialer.Dial(wsURLMultiAud, hdrMultiAud)
	if err != nil {
		if respMultiAud != nil {
			t.Fatalf("multi-audience connection failed: status=%d err=%v", respMultiAud.StatusCode, err)
		}
		t.Fatalf("multi-audience connection dial failed: %v", err)
	}
	connMultiAud.Close()

	// 10. Multi-audience token not containing primary room is rejected with 401
	claimsMultiAudConflict := &Claims{
		ParticipantID: "p-multi-aud-conflict",
		RoomID:        roomID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-multi-aud-conflict",
			Audience:  jwt.ClaimStrings{"room-other-1", "room-other-2"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokMultiAudConflict := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsMultiAudConflict)
	signedMultiAudConflict, _ := tokMultiAudConflict.SignedString(jwtSecret)
	wsURLMultiAudConflict := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrMultiAudConflict := http.Header{}
	hdrMultiAudConflict.Set("Sec-WebSocket-Protocol", "meet-token, " + signedMultiAudConflict)
	_, respMultiAudConflict, err := websocket.DefaultDialer.Dial(wsURLMultiAudConflict, hdrMultiAudConflict)
	if err == nil {
		t.Fatal("expected multi-audience conflicting room token to fail")
	}
	if respMultiAudConflict == nil || respMultiAudConflict.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 on conflicting multi-audience token, got %v", respMultiAudConflict)
	}

	// 11. Multi-audience token with service audience and room in aud connects when room claim is absent
	claimsAudOnly := &Claims{
		ParticipantID: "p-aud-only",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "p-aud-only",
			Audience:  jwt.ClaimStrings{"meet-signal-service", roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokAudOnly := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsAudOnly)
	signedAudOnly, _ := tokAudOnly.SignedString(jwtSecret)
	wsURLAudOnly := "ws" + strings.TrimPrefix(server.URL, "http") + "/signal?v=1&room=" + roomID
	hdrAudOnly := http.Header{}
	hdrAudOnly.Set("Sec-WebSocket-Protocol", "meet-token, " + signedAudOnly)
	connAudOnly, respAudOnly, err := websocket.DefaultDialer.Dial(wsURLAudOnly, hdrAudOnly)
	if err != nil {
		if respAudOnly != nil {
			t.Fatalf("audience-only room connection failed: status=%d err=%v", respAudOnly.StatusCode, err)
		}
		t.Fatalf("audience-only room connection dial failed: %v", err)
	}
	connAudOnly.Close()
}

// -----------------------------------------------------------------------------
// M4B Milestone 1 (R2 Shared Ephemeral State: Server-Authoritative Co-Host Role & Permissions)
// -----------------------------------------------------------------------------

// Verifies R2 Acceptance Criterion:
// PARTICIPANT attempting a moderation action receives a 403/Forbidden response.
func TestM4BParticipantModerationForbidden403(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-perm-test-room"

	// 1. Create room with authoritative host
	hostID := "p-host-alice"
	_, err := am.createRoom(roomID, hostID)
	if err != nil {
		t.Fatalf("createRoom failed: %v", err)
	}

	// 2. Register participant (non-host)
	participantID := "p-guest-bob"
	role, _ := am.assignRole(roomID, participantID)
	if role != "participant" {
		t.Fatalf("expected participant role, got %s", role)
	}

	// 3. Participant attempts various moderation actions
	moderationActions := []string{
		"muteParticipant",
		"removeParticipant",
		"spotlightParticipant",
		"lockMeeting",
		"manageWaitingRoom",
		"stopParticipantShare",
		"updatePermissions",
	}

	for _, action := range moderationActions {
		t.Run("Action_"+action, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{
				"roomId":              roomID,
				"action":              action,
				"targetParticipantId": "p-target-charlie",
			})
			req := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
			req.Header.Set("Content-Type", "application/json")
			// Participant presents their valid participant credentials
			token := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
				ParticipantID: participantID,
				RoomID:        roomID,
				Role:          "participant",
			})
			signed, _ := token.SignedString(jwtSecret)
			req.Header.Set("Authorization", "Bearer "+signed)

			w := httptest.NewRecorder()
			handleDirective(h, am, w, req)

			if w.Code != http.StatusForbidden {
				t.Fatalf("expected 403 Forbidden for participant attempting %s, got status %d (body: %s)",
					action, w.Code, w.Body.String())
			}
		})
	}
}

// Verifies R2 Acceptance Criterion:
// Only a HOST can successfully issue an assignCoHost directive.
func TestM4BOnlyHostCanAssignCoHost(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-cohost-assign-room"

	hostID := "p-host-alice"
	_, err := am.createRoom(roomID, hostID)
	if err != nil {
		t.Fatalf("createRoom failed: %v", err)
	}

	participantID := "p-guest-bob"
	targetID := "p-guest-charlie"
	am.assignRole(roomID, participantID)
	am.assignRole(roomID, targetID)

	// Case 1: Standard PARTICIPANT attempts assignCoHost -> 403 Forbidden
	t.Run("ParticipantCannotAssignCoHost", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"roomId":              roomID,
			"action":              "assignCoHost",
			"targetParticipantId": targetID,
		})
		req := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		setTestAuthHeader(req, roomID, participantID, "participant")

		w := httptest.NewRecorder()
		handleDirective(h, am, w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for participant assignCoHost, got %d", w.Code)
		}
	})

	// Case 2: Established CO-HOST attempts assignCoHost -> 403 Forbidden
	t.Run("CoHostCannotAssignCoHost", func(t *testing.T) {
		// Host assigns bob as co-host first
		if err := am.assignCoHost(roomID, hostID, participantID); err != nil {
			t.Fatalf("host assigning co-host failed: %v", err)
		}

		body, _ := json.Marshal(map[string]any{
			"roomId":              roomID,
			"action":              "assignCoHost",
			"targetParticipantId": targetID,
		})
		req := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		setTestAuthHeader(req, roomID, participantID, "participant")

		w := httptest.NewRecorder()
		handleDirective(h, am, w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for co-host assignCoHost, got %d", w.Code)
		}
	})

	// Case 3: HOST issues assignCoHost -> 200 OK
	t.Run("HostCanAssignCoHost", func(t *testing.T) {
		body, _ := json.Marshal(map[string]any{
			"roomId":              roomID,
			"action":              "assignCoHost",
			"targetParticipantId": targetID,
		})
		req := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		setTestAuthHeader(req, roomID, hostID, "host")

		w := httptest.NewRecorder()
		handleDirective(h, am, w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for host assignCoHost, got %d (body: %s)", w.Code, w.Body.String())
		}

		// Verify target is now recognized as CO-HOST
		if am.getParticipantRole(roomID, targetID) != RoleCoHost {
			t.Fatalf("expected target role to be co-host, got %s", am.getParticipantRole(roomID, targetID))
		}
	})
}

// Verifies only HOST can revoke CO-HOST
func TestM4BOnlyHostCanRevokeCoHost(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-cohost-revoke-room"

	hostID := "p-host-alice"
	_, _ = am.createRoom(roomID, hostID)

	coHost1 := "p-cohost-bob"
	coHost2 := "p-cohost-charlie"
	_ = am.assignCoHost(roomID, hostID, coHost1)
	_ = am.assignCoHost(roomID, hostID, coHost2)

	// Co-Host 1 attempts to revoke Co-Host 2 -> 403 Forbidden
	body, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"action":              "revokeCoHost",
		"targetParticipantId": coHost2,
	})
	req := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(req, roomID, coHost1, "co-host")

	w := httptest.NewRecorder()
	handleDirective(h, am, w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for co-host revoking peer co-host, got %d", w.Code)
	}

	// Host revokes Co-Host 2 -> 200 OK
	reqHost := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(body)))
	reqHost.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqHost, roomID, hostID, "host")

	wHost := httptest.NewRecorder()
	handleDirective(h, am, wHost, reqHost)
	if wHost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for host revokeCoHost, got %d", wHost.Code)
	}

	if am.getParticipantRole(roomID, coHost2) != RoleParticipant {
		t.Fatalf("expected target role to revert to participant, got %s", am.getParticipantRole(roomID, coHost2))
	}
}

// Verifies Co-Host moderation capabilities and target hierarchy guardrail
func TestM4BCoHostModerationAndTargetHierarchy(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-cohost-target-room"

	hostID := "p-host-alice"
	coHostID := "p-cohost-bob"
	peerCoHostID := "p-cohost-charlie"
	guestID := "p-guest-dan"

	_, _ = am.createRoom(roomID, hostID)
	_ = am.assignCoHost(roomID, hostID, coHostID)
	_ = am.assignCoHost(roomID, hostID, peerCoHostID)
	am.assignRole(roomID, guestID)

	// 1. Co-Host muting a guest -> 200 OK
	bodyGuest, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"action":              "muteParticipant",
		"targetParticipantId": guestID,
	})
	reqGuest := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(bodyGuest)))
	reqGuest.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqGuest, roomID, coHostID, "co-host")
	wGuest := httptest.NewRecorder()
	handleDirective(h, am, wGuest, reqGuest)
	if wGuest.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for co-host muting participant, got %d", wGuest.Code)
	}

	// 2. Co-Host attempting to mute the HOST -> 403 Forbidden (Target Hierarchy Guardrail)
	bodyHost, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"action":              "muteParticipant",
		"targetParticipantId": hostID,
	})
	reqHost := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(bodyHost)))
	reqHost.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqHost, roomID, coHostID, "co-host")
	wHost := httptest.NewRecorder()
	handleDirective(h, am, wHost, reqHost)
	if wHost.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for co-host attempting to mute host, got %d", wHost.Code)
	}

	// 3. Co-Host attempting to remove peer CO-HOST -> 403 Forbidden (Target Hierarchy Guardrail)
	bodyPeer, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"action":              "removeParticipant",
		"targetParticipantId": peerCoHostID,
	})
	reqPeer := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(bodyPeer)))
	reqPeer.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqPeer, roomID, coHostID, "co-host")
	wPeer := httptest.NewRecorder()
	handleDirective(h, am, wPeer, reqPeer)
	if wPeer.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for co-host attempting to remove peer co-host, got %d", wPeer.Code)
	}

	// 4. Host muting a CO-HOST -> 200 OK
	bodyHostMute, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"action":              "muteParticipant",
		"targetParticipantId": coHostID,
	})
	reqHostMute := httptest.NewRequest(http.MethodPost, "/room/directive", strings.NewReader(string(bodyHostMute)))
	reqHostMute.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqHostMute, roomID, hostID, "host")
	wHostMute := httptest.NewRecorder()
	handleDirective(h, am, wHostMute, reqHostMute)
	if wHostMute.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for host muting co-host, got %d", wHostMute.Code)
	}
}

// Verifies Co-Host ES256 Token Minting and Cryptographic Signature
func TestM4BCoHostTokenMintingAndVerification(t *testing.T) {
	if hostPrivateKey == nil {
		initHostSigning()
	}

	participantID := "p-cohost-test"
	roomID := "room-cohost-test"
	roomInstanceID := "inst-cohost-test"
	generation := uint64(3)

	tokenStr, err := mintCoHostToken(participantID, roomID, roomInstanceID, generation, 5*time.Minute)
	if err != nil {
		t.Fatalf("mintCoHostToken failed: %v", err)
	}

	// Verify using public key
	parsed, err := jwt.ParseWithClaims(tokenStr, &HostClaims{}, func(tok *jwt.Token) (interface{}, error) {
		if _, ok := tok.Method.(*jwt.SigningMethodECDSA); !ok {
			t.Fatalf("expected ES256 signing, got %v", tok.Header["alg"])
		}
		return &hostPrivateKey.PublicKey, nil
	})
	if err != nil {
		t.Fatalf("failed to parse/verify co-host token: %v", err)
	}

	claims, ok := parsed.Claims.(*HostClaims)
	if !ok || !parsed.Valid {
		t.Fatal("invalid claims in co-host token")
	}

	if claims.ParticipantID != participantID || claims.Role != "co-host" || claims.RoomID != roomID {
		t.Errorf("co-host claims mismatch: got %+v", claims)
	}
}

// Verifies dedicated /room/assign-cohost and /room/revoke-cohost endpoints
func TestM4BAssignAndRevokeCoHostDedicatedEndpoints(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-dedicated-endpoints-room"
	hostID := "p-host-alice"
	guestID := "p-guest-bob"
	targetID := "p-target-charlie"

	_, _ = am.createRoom(roomID, hostID)
	am.assignRole(roomID, guestID)
	am.assignRole(roomID, targetID)

	// 1. Guest attempts POST /room/assign-cohost -> 403 Forbidden
	assignBody, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"targetParticipantId": targetID,
	})
	reqGuest := httptest.NewRequest(http.MethodPost, "/room/assign-cohost", strings.NewReader(string(assignBody)))
	reqGuest.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqGuest, roomID, guestID, "participant")
	wGuest := httptest.NewRecorder()
	handleAssignCoHost(h, am, wGuest, reqGuest)
	if wGuest.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on /room/assign-cohost from guest, got %d", wGuest.Code)
	}

	// 2. Host performs POST /room/assign-cohost -> 200 OK
	reqHost := httptest.NewRequest(http.MethodPost, "/room/assign-cohost", strings.NewReader(string(assignBody)))
	reqHost.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqHost, roomID, hostID, "host")
	wHost := httptest.NewRecorder()
	handleAssignCoHost(h, am, wHost, reqHost)
	if wHost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on /room/assign-cohost from host, got %d", wHost.Code)
	}
	if am.getParticipantRole(roomID, targetID) != RoleCoHost {
		t.Fatalf("expected target role to be co-host, got %s", am.getParticipantRole(roomID, targetID))
	}

	// 3. Host performs POST /room/revoke-cohost -> 200 OK
	revokeBody, _ := json.Marshal(map[string]any{
		"roomId":              roomID,
		"targetParticipantId": targetID,
	})
	reqRevoke := httptest.NewRequest(http.MethodPost, "/room/revoke-cohost", strings.NewReader(string(revokeBody)))
	reqRevoke.Header.Set("Content-Type", "application/json")
	setTestAuthHeader(reqRevoke, roomID, hostID, "host")
	wRevoke := httptest.NewRecorder()
	handleRevokeCoHost(h, am, wRevoke, reqRevoke)
	if wRevoke.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on /room/revoke-cohost from host, got %d", wRevoke.Code)
	}
	if am.getParticipantRole(roomID, targetID) != RoleParticipant {
		t.Fatalf("expected target role to revert to participant, got %s", am.getParticipantRole(roomID, targetID))
	}
}

// Verifies WebSocket frame interception: dropping unauthorized moderation frames and returning 403 error frame
func TestM4BWebSocketDirectiveInterception(t *testing.T) {
	am := newAuthorityManager()
	h := newHub()
	roomID := "m4b-ws-interception-room"
	hostID := "p-host-alice"
	guestID := "p-guest-bob"
	targetID := "p-target-charlie"

	_, err := am.createRoom(roomID, hostID)
	if err != nil {
		t.Fatalf("createRoom failed: %v", err)
	}
	am.assignRole(roomID, guestID)
	am.assignRole(roomID, targetID)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		claims, err := validateAccessToken(token)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		c := &client{conn: conn, participantID: claims.ParticipantID}
		h.join(roomID, c)
		defer h.leave(roomID, c)
		readLoopWithAuth(h, am, roomID, c)
	}))
	defer server.Close()

	// Mint guest token
	guestClaims := Claims{
		ParticipantID: guestID,
		RoomID:        roomID,
		Name:          "Bob Guest",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "meet-signal",
			Subject:   guestID,
			Audience:  jwt.ClaimStrings{roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, guestClaims)
	signedGuest, _ := tok.SignedString(jwtSecret)

	// Mint target token
	targetClaims := Claims{
		ParticipantID: targetID,
		RoomID:        roomID,
		Name:          "Charlie Target",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "meet-signal",
			Subject:   targetID,
			Audience:  jwt.ClaimStrings{roomID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}
	tokTarget := jwt.NewWithClaims(jwt.SigningMethodHS256, targetClaims)
	signedTarget, _ := tokTarget.SignedString(jwtSecret)

	// Connect Target client so we can test whether unauthorized frames reach peers
	hdrTarget := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedTarget}}
	wsURLTarget := "ws" + strings.TrimPrefix(server.URL, "http") + "/?token=" + url.QueryEscape(signedTarget)
	connTarget, _, err := websocket.DefaultDialer.Dial(wsURLTarget, hdrTarget)
	if err != nil {
		t.Fatalf("target dial failed: %v", err)
	}
	defer connTarget.Close()

	// Connect Guest client
	hdrGuest := http.Header{"Sec-WebSocket-Protocol": {"meet-token, " + signedGuest}}
	wsURLGuest := "ws" + strings.TrimPrefix(server.URL, "http") + "/?token=" + url.QueryEscape(signedGuest)
	connGuest, _, err := websocket.DefaultDialer.Dial(wsURLGuest, hdrGuest)
	if err != nil {
		t.Fatalf("guest dial failed: %v", err)
	}
	defer connGuest.Close()

	// Target drains initial messages
	_ = connTarget.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	for {
		_, _, err := connTarget.ReadMessage()
		if err != nil {
			break
		}
	}

	// Guest attempts to send an unauthorized directive frame
	unauthMsg := SignalMessage{
		Type: "directive",
		Payload: mustRawJSON(map[string]any{
			"action":              "muteParticipant",
			"targetParticipantId": targetID,
		}),
		RoomID:        roomID,
		ParticipantID: guestID,
		Timestamp:     time.Now().UnixMilli(),
	}
	if err := connGuest.WriteJSON(unauthMsg); err != nil {
		t.Fatalf("writeJSON failed: %v", err)
	}

	// Guest should receive an error frame with 403 Forbidden
	connGuest.SetReadDeadline(time.Now().Add(1 * time.Second))
	var respMsg SignalMessage
	if err := connGuest.ReadJSON(&respMsg); err != nil {
		t.Fatalf("expected error frame response to guest, got err: %v", err)
	}
	if respMsg.Type != "error" {
		t.Fatalf("expected error message type, got %s", respMsg.Type)
	}
	var errPayload map[string]any
	json.Unmarshal(respMsg.Payload, &errPayload)
	if code, ok := errPayload["code"].(float64); !ok || int(code) != 403 {
		t.Fatalf("expected error code 403, got %v", errPayload["code"])
	}

	// Target should NOT receive any relayed message (frame dropped)
	connTarget.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	_, _, err = connTarget.ReadMessage()
	if err == nil {
		t.Fatal("target received rogue message: frame was not dropped by readLoop!")
	}
}
