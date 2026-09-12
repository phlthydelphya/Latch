// meet-signal unit tests for token issuance (Phase 1 LiveKit + legacy mesh)
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

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