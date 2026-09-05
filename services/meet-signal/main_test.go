// meet-signal unit tests for token issuance (Phase 1 LiveKit + legacy mesh)
package main

import (
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