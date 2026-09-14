// meet-signal — W1 signaling service.
// Implements: POST /token (signed JWT), WSS /signal (authenticated relay),
// GET /healthz, GET /metrics (stub).
// Scope: JWT issuance + verification + in-room WebSocket relay. No refresh,
// OAuth, OIDC federation, key rotation, or JWKS (per M1 scope).
// Phase 1: Dual-path token issuance — LiveKit JWT with VideoGrant when LIVEKIT_API_SECRET is set,
// else legacy mesh token. Preserves existing WSS /signal relay.
package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

func canonicalRoomID(id string) string {
	return strings.ToLower(strings.TrimSpace(id))
}

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// Claims is the minimal signed claim set used for signaling auth (legacy mesh).
type Claims struct {
	ParticipantID string             `json:"sub"`
	RoomID        string             `json:"room"`
	Name          string             `json:"name"`
	Role          string             `json:"role,omitempty"`
	Video         *LiveKitVideoGrant `json:"video,omitempty"`
	jwt.RegisteredClaims
}

// LiveKitClaims represents the JWT claims for LiveKit access tokens.
// Uses golang-jwt/jwt/v5 with custom VideoGrant claims (no livekit/protocol dependency).
type LiveKitClaims struct {
	Video    LiveKitVideoGrant `json:"video"`
	Metadata string            `json:"metadata,omitempty"`
	Role     string            `json:"role,omitempty"`
	jwt.RegisteredClaims
}

type LiveKitVideoGrant struct {
	RoomJoin       bool   `json:"roomJoin"`
	Room           string `json:"room"`
	CanPublish     bool   `json:"canPublish"`
	CanSubscribe   bool   `json:"canSubscribe"`
	CanPublishData bool   `json:"canPublishData"`
}

type TokenRequest struct {
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

type TokenResponse struct {
	Token          string `json:"token"`        // Legacy mesh token / LiveKit JWT (backward compat)
	LiveKitToken   string `json:"livekitToken"` // Alias for token when LiveKit path is used
	ParticipantID  string `json:"participantId"`
	RoomID         string `json:"roomId"`
	Role           string `json:"role"`                     // M4A: "host" or "participant"; M4B: "co-host"
	HostToken      string `json:"hostToken,omitempty"`      // M4A: Server-signed ES256 host claim (if role == "host")
	CoHostToken    string `json:"coHostToken,omitempty"`    // M4B: Server-signed ES256 co-host claim (if role == "co-host")
	HostKey        string `json:"hostKey,omitempty"`        // M4A: Public key in hex for peer verification
	SessionToken   string `json:"sessionToken,omitempty"`   // SEC-02B: private session capability (identity proof)
	ResumeHandle   string `json:"resumeHandle,omitempty"`   // SEC-02C: one-use host resume handle
	RoomInstanceID string `json:"roomInstanceId,omitempty"` // SEC-02B: room incarnation binding
	URL            string `json:"url,omitempty"`            // Legacy field (backward compat)
	SFUUrl         string `json:"sfuUrl,omitempty"`         // Alias for url when LiveKit path is used
}

type RoomAuthority struct {
	RoomID              string              `json:"roomId"`
	RoomInstanceID      string              `json:"roomInstanceId"`
	HostID              string              `json:"hostId"`
	CoHostIDs           map[string]struct{} `json:"coHostIds,omitempty"` // M4B R2: In-memory co-host IDs
	AuthorityGeneration uint64              `json:"authorityGeneration"`
	CreatedAt           time.Time           `json:"createdAt"`
	HostUpdatedAt       time.Time           `json:"hostUpdatedAt"`
	GraceExpiry         time.Time           `json:"graceExpiry,omitempty"`
	Locked              bool                `json:"locked"`
}

// M4B R2: 4-tier role hierarchy
type Role string

const (
	RoleHost        Role = "host"
	RoleCoHost      Role = "co-host"
	RoleParticipant Role = "participant"
	RoleWaiting     Role = "waiting"
)

var roleHierarchy = map[Role]int{
	RoleHost:        4,
	RoleCoHost:      3,
	RoleParticipant: 2,
	RoleWaiting:     1,
}

func canonicalRole(r string) Role {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "host":
		return RoleHost
	case "co-host", "cohost":
		return RoleCoHost
	case "waiting", "lobby":
		return RoleWaiting
	default:
		return RoleParticipant
	}
}

// M4B R2: Granular moderation actions
type Action string

const (
	ActionAssignCoHost         Action = "assignCoHost"
	ActionRevokeCoHost         Action = "revokeCoHost"
	ActionTransferHost         Action = "transferHost"
	ActionEndMeeting           Action = "endMeeting"
	ActionMuteParticipant      Action = "muteParticipant"
	ActionRemoveParticipant    Action = "removeParticipant"
	ActionSpotlightParticipant Action = "spotlightParticipant"
	ActionAdmitParticipant     Action = "admitParticipant"
	ActionRejectParticipant    Action = "rejectParticipant"
	ActionLockMeeting          Action = "lockMeeting"
	ActionManageWaitingRoom    Action = "manageWaitingRoom"
	ActionStopParticipantShare Action = "stopParticipantShare"
	ActionUpdatePermissions    Action = "updatePermissions"
)

func canonicalAction(act string) Action {
	cleaned := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(act, "-", ""), "_", ""))
	switch cleaned {
	case "assigncohost":
		return ActionAssignCoHost
	case "revokecohost":
		return ActionRevokeCoHost
	case "transferhost":
		return ActionTransferHost
	case "endmeeting":
		return ActionEndMeeting
	case "muteparticipant", "mute":
		return ActionMuteParticipant
	case "removeparticipant", "remove":
		return ActionRemoveParticipant
	case "spotlightparticipant", "spotlight":
		return ActionSpotlightParticipant
	case "admitparticipant", "waitingroomadmit", "admit":
		return ActionAdmitParticipant
	case "rejectparticipant", "waitingroomreject", "reject":
		return ActionRejectParticipant
	case "lockmeeting", "lockroom", "lock":
		return ActionLockMeeting
	case "managewaitingroom", "waitingroom":
		return ActionManageWaitingRoom
	case "stopparticipantshare", "stopshare":
		return ActionStopParticipantShare
	case "updatepermissions":
		return ActionUpdatePermissions
	default:
		return Action(act)
	}
}

type authorityManager struct {
	mu    sync.RWMutex
	rooms map[string]*RoomAuthority
}

func newAuthorityManager() *authorityManager {
	return &authorityManager{
		rooms: make(map[string]*RoomAuthority),
	}
}

// newRoomInstanceID returns an unguessable room-incarnation identifier used to
// scope private sessions so a recreated room cannot inherit old identity state.
func newRoomInstanceID() string {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "inst-" + uuid.New().String()
	}
	return hex.EncodeToString(raw)
}

func (am *authorityManager) createRoom(roomID, creatorID string) (*RoomAuthority, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	now := time.Now()
	auth, exists := am.rooms[roomID]
	if exists && auth.HostID != "" && (auth.GraceExpiry.IsZero() || auth.GraceExpiry.After(now)) {
		return nil, errors.New("room already exists with active host")
	}

	auth = &RoomAuthority{
		RoomID:              roomID,
		RoomInstanceID:      newRoomInstanceID(),
		HostID:              creatorID,
		CoHostIDs:           make(map[string]struct{}),
		AuthorityGeneration: 1,
		CreatedAt:           now,
		HostUpdatedAt:       now,
		Locked:              false,
	}
	am.rooms[roomID] = auth
	return auth, nil
}

func (am *authorityManager) assignRole(roomID, participantID string) (string, bool) {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	now := time.Now()
	if !exists {
		// Room not created via /room/create — register unhosted room
		am.rooms[roomID] = &RoomAuthority{
			RoomID:              roomID,
			RoomInstanceID:      newRoomInstanceID(),
			HostID:              "",
			CoHostIDs:           make(map[string]struct{}),
			AuthorityGeneration: 1,
			CreatedAt:           now,
			HostUpdatedAt:       now,
		}
		return "participant", false
	}

	// Role lookup cannot reassign authority or cancel host grace.
	if auth.HostID != "" && auth.HostID == participantID {
		return "host", false
	}
	if auth.CoHostIDs != nil {
		if _, ok := auth.CoHostIDs[participantID]; ok {
			return "co-host", false
		}
	}

	return "participant", false
}

func (am *authorityManager) getAuthority(roomID string) (*RoomAuthority, bool) {
	am.mu.RLock()
	defer am.mu.RUnlock()
	auth, ok := am.rooms[roomID]
	if !ok {
		return nil, false
	}
	copy := *auth
	if auth.CoHostIDs != nil {
		copy.CoHostIDs = make(map[string]struct{}, len(auth.CoHostIDs))
		for k, v := range auth.CoHostIDs {
			copy.CoHostIDs[k] = v
		}
	}
	return &copy, true
}

func (am *authorityManager) getParticipantRole(roomID, participantID string) Role {
	am.mu.RLock()
	defer am.mu.RUnlock()

	auth, exists := am.rooms[roomID]
	if !exists {
		return RoleParticipant
	}
	if auth.HostID != "" && auth.HostID == participantID {
		return RoleHost
	}
	if auth.CoHostIDs != nil {
		if _, ok := auth.CoHostIDs[participantID]; ok {
			return RoleCoHost
		}
	}
	return RoleParticipant
}

func (am *authorityManager) assignCoHost(roomID, requesterID, targetParticipantID string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	if !exists {
		return errors.New("room not found")
	}
	// Strict invariant: ONLY HOST can assign CO-HOST
	if auth.HostID != requesterID {
		return errors.New("unauthorized: requester is not host")
	}
	if targetParticipantID == "" || targetParticipantID == auth.HostID {
		return errors.New("invalid target participant")
	}
	if auth.CoHostIDs == nil {
		auth.CoHostIDs = make(map[string]struct{})
	}
	auth.CoHostIDs[targetParticipantID] = struct{}{}
	return nil
}

func (am *authorityManager) revokeCoHost(roomID, requesterID, targetParticipantID string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	if !exists {
		return errors.New("room not found")
	}
	// Strict invariant: ONLY HOST can revoke CO-HOST
	if auth.HostID != requesterID {
		return errors.New("unauthorized: requester is not host")
	}
	if auth.CoHostIDs != nil {
		delete(auth.CoHostIDs, targetParticipantID)
	}
	return nil
}

func (am *authorityManager) transferHost(roomID, requesterID, targetParticipantID string, expectedGeneration uint64) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	if !exists {
		return errors.New("room not found")
	}
	if auth.HostID != requesterID {
		return errors.New("unauthorized: requester is not host")
	}
	if auth.AuthorityGeneration != expectedGeneration {
		return errGenerationConflict
	}
	auth.HostID = targetParticipantID
	auth.HostUpdatedAt = time.Now()
	auth.GraceExpiry = time.Time{}
	auth.AuthorityGeneration++
	if auth.CoHostIDs != nil {
		delete(auth.CoHostIDs, targetParticipantID)
	}
	return nil
}

// revokeAuthority clears the host and advances the generation, invalidating all
// prior host credentials. It is used for explicit revocation/reset and is
// atomic with respect to other authority transitions.
func (am *authorityManager) revokeAuthority(roomID string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	auth, exists := am.rooms[roomID]
	if !exists {
		return
	}
	auth.HostID = ""
	auth.GraceExpiry = time.Time{}
	auth.AuthorityGeneration++
	auth.CoHostIDs = make(map[string]struct{})
}

// consumeResumeHandle atomically re-checks that participantID is still the
// current host and consumes the one-use resume handle bound to the current
// room instance and generation. It returns the current generation on success.
func (am *authorityManager) consumeResumeHandle(roomID, participantID string, rh *resumeHandleStore, handle string) (uint64, bool) {
	am.mu.Lock()
	defer am.mu.Unlock()
	auth, exists := am.rooms[roomID]
	if !exists || auth.HostID != participantID {
		return 0, false
	}
	if !rh.consume(handle, participantID, auth.RoomInstanceID, auth.AuthorityGeneration) {
		return 0, false
	}
	return auth.AuthorityGeneration, true
}

func (am *authorityManager) startHostGrace(roomID, hostID string, graceDuration time.Duration, onTimeout func(string)) {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	if !exists || auth.HostID != hostID {
		return
	}
	auth.GraceExpiry = time.Now().Add(graceDuration)

	go func() {
		time.Sleep(graceDuration)
		am.mu.Lock()
		defer am.mu.Unlock()

		currentAuth, stillExists := am.rooms[roomID]
		if !stillExists || currentAuth.HostID != hostID {
			return
		}
		if time.Now().Before(currentAuth.GraceExpiry) {
			return
		}

		currentAuth.HostID = ""
		currentAuth.AuthorityGeneration++
		if onTimeout != nil {
			go onTimeout(roomID)
		}
	}()
}

// SEC-02B: private session capability store. The raw capability is a 256-bit
// unguessable bearer identity proof delivered only in the direct bootstrap
// response; only its SHA-256 hash is retained in volatile server state.
type sessionRecord struct {
	ParticipantID  string
	RoomInstanceID string
	Purpose        string // "host" | "participant"
	SessionVersion uint64
	ExpiresAt      time.Time
}

type sessionStore struct {
	mu       sync.RWMutex
	sessions map[string]sessionRecord
}

func newSessionStore() *sessionStore {
	return &sessionStore{sessions: make(map[string]sessionRecord)}
}

func sessionCapabilityHash(capability string) string {
	sum := sha256.Sum256([]byte(capability))
	return hex.EncodeToString(sum[:])
}

func (s *sessionStore) issue(participantID, roomInstanceID, purpose string, ttl time.Duration) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	capability := base64.RawURLEncoding.EncodeToString(raw)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionCapabilityHash(capability)] = sessionRecord{
		ParticipantID:  participantID,
		RoomInstanceID: roomInstanceID,
		Purpose:        purpose,
		SessionVersion: 1,
		ExpiresAt:      time.Now().Add(ttl),
	}
	return capability, nil
}

func (s *sessionStore) authenticate(capability string) (sessionRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.sessions[sessionCapabilityHash(capability)]
	if !ok || time.Now().After(record.ExpiresAt) {
		return sessionRecord{}, false
	}
	return record, true
}

func (s *sessionStore) rotate(capability string, ttl time.Duration) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := sessionCapabilityHash(capability)
	record, ok := s.sessions[key]
	if !ok || time.Now().After(record.ExpiresAt) {
		return "", errPrivateSessionInvalid
	}
	delete(s.sessions, key)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	newCapability := base64.RawURLEncoding.EncodeToString(raw)
	record.SessionVersion++
	record.ExpiresAt = time.Now().Add(ttl)
	s.sessions[sessionCapabilityHash(newCapability)] = record
	return newCapability, nil
}

func (s *sessionStore) revoke(capability string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionCapabilityHash(capability))
}

func (s *sessionStore) hasActiveSession(participantID, roomInstanceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range s.sessions {
		if record.ParticipantID == participantID && record.RoomInstanceID == roomInstanceID && time.Now().Before(record.ExpiresAt) {
			return true
		}
	}
	return false
}

// SEC-02C: one-use resume handle store. A host resume presents a single-use
// handle bound to (room instance, authority generation, participant, session
// version). Consumption is atomic: exactly one concurrent call wins.
type resumeHandleRecord struct {
	ParticipantID  string
	RoomInstanceID string
	Generation     uint64
	SessionVersion uint64
	ExpiresAt      time.Time
	Used           bool
}

type resumeHandleStore struct {
	mu      sync.RWMutex
	handles map[string]resumeHandleRecord
}

func newResumeHandleStore() *resumeHandleStore {
	return &resumeHandleStore{handles: make(map[string]resumeHandleRecord)}
}

func (r *resumeHandleStore) issue(participantID, roomInstanceID string, generation, sessionVersion uint64, ttl time.Duration) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	handle := base64.RawURLEncoding.EncodeToString(raw)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handles[sessionCapabilityHash(handle)] = resumeHandleRecord{
		ParticipantID:  participantID,
		RoomInstanceID: roomInstanceID,
		Generation:     generation,
		SessionVersion: sessionVersion,
		ExpiresAt:      time.Now().Add(ttl),
		Used:           false,
	}
	return handle, nil
}

func (r *resumeHandleStore) consume(handle, participantID, roomInstanceID string, generation uint64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := sessionCapabilityHash(handle)
	record, ok := r.handles[key]
	if !ok || record.Used || time.Now().After(record.ExpiresAt) {
		return false
	}
	if record.ParticipantID != participantID || record.RoomInstanceID != roomInstanceID || record.Generation != generation {
		return false
	}
	record.Used = true
	r.handles[key] = record
	return true
}

func (r *resumeHandleStore) revoke(handle string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.handles, sessionCapabilityHash(handle))
}

// SEC-02B error contracts. These are returned by the identity-binding flows and
// mapped to HTTP status codes by the privileged handlers.
var (
	errPrivateSessionRequired        = errors.New("private_session_required")
	errPrivateSessionInvalid         = errors.New("private_session_invalid")
	errIdentityMismatch              = errors.New("identity_mismatch")
	errHostProofRequired             = errors.New("host_proof_required")
	errTransferTargetUnauthenticated = errors.New("transfer_target_unauthenticated")
	errGenerationConflict            = errors.New("generation_conflict")
	errResumeHandleInvalid           = errors.New("resume_handle_invalid")
)

// bearerToken extracts the credential from an Authorization/X-*-Proof header.
// A missing or non-Bearer scheme returns the raw value unchanged so downstream
// validation fails closed rather than treating the header as absent.
func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if len(header) >= 7 && strings.EqualFold(header[:7], "Bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return header
}

// writeAuthError maps SEC-02B/C authentication and authority errors to stable
// HTTP responses. Every mapping fails closed without state mutation.
func writeAuthError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	switch {
	case errors.Is(err, errPrivateSessionRequired),
		errors.Is(err, errPrivateSessionInvalid),
		errors.Is(err, errResumeHandleInvalid):
		status = http.StatusUnauthorized
	case errors.Is(err, errIdentityMismatch),
		errors.Is(err, errHostProofRequired),
		errors.Is(err, errTransferTargetUnauthenticated):
		status = http.StatusForbidden
	case errors.Is(err, errGenerationConflict):
		status = http.StatusConflict
	}
	http.Error(w, err.Error(), status)
}

// headerPresent reports whether a header key is present, case-insensitively and
// independent of value. A present-but-empty credential header still selects the
// resume path so a failed attempt never downgrades to guest issuance.
func headerPresent(h http.Header, name string) bool {
	for key := range h {
		if strings.EqualFold(key, name) {
			return true
		}
	}
	return false
}

// headerValue returns the first value for a header key, case-insensitively.
func headerValue(h http.Header, name string) string {
	for key, values := range h {
		if strings.EqualFold(key, name) && len(values) > 0 {
			return values[0]
		}
	}
	return ""
}

// SignalMessage mirrors the client signaling frame shape:
// { type, payload, roomId, participantId, timestamp }.
type SignalMessage struct {
	Type          string          `json:"type"`
	Payload       json.RawMessage `json:"payload"`
	RoomID        string          `json:"roomId"`
	ParticipantID string          `json:"participantId"`
	Timestamp     int64           `json:"timestamp"`
}

type client struct {
	conn          *websocket.Conn
	participantID string
	mu            sync.Mutex
}

func (c *client) writeJSON(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

func (c *client) writeRaw(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, b)
}

type hub struct {
	mu    sync.Mutex
	rooms map[string]map[*client]struct{}
}

func newHub() *hub {
	return &hub{rooms: make(map[string]map[*client]struct{})}
}

// join registers the client and returns the peers already present in the room.
func (h *hub) join(roomID string, c *client) []*client {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[roomID] == nil {
		h.rooms[roomID] = make(map[*client]struct{})
	}
	existing := make([]*client, 0, len(h.rooms[roomID]))
	for peer := range h.rooms[roomID] {
		existing = append(existing, peer)
	}
	h.rooms[roomID][c] = struct{}{}
	return existing
}

func (h *hub) leave(roomID string, c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[roomID]; ok {
		delete(room, c)
		if len(room) == 0 {
			delete(h.rooms, roomID)
		}
	}
}

// peers returns the other clients in the room (excluding c).
func (h *hub) peers(roomID string, c *client) []*client {
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[roomID]
	peers := make([]*client, 0, len(room)-1)
	for peer := range room {
		if peer != c {
			peers = append(peers, peer)
		}
	}
	return peers
}

// clientByParticipant returns the live signaling connection owned by the given
// authenticated participant in the room. It is used to prove a private delivery
// channel exists before committing an authority transition.
func (h *hub) clientByParticipant(roomID, participantID string) (*client, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for peer := range h.rooms[roomID] {
		if peer.participantID == participantID {
			return peer, true
		}
	}
	return nil, false
}

// deliverHostCredential writes a private host-credential frame only to the
// target participant's authenticated signaling connection. It returns false when
// the target has no active connection so callers can fall back to a private
// retrieval flow without broadcasting. It must never be substituted for
// h.peers(roomID, nil) when delivering private credentials.
func (h *hub) deliverHostCredential(roomID, targetParticipantID string, payload json.RawMessage) bool {
	h.mu.Lock()
	room := h.rooms[roomID]
	var target *client
	for peer := range room {
		if peer.participantID == targetParticipantID {
			target = peer
			break
		}
	}
	h.mu.Unlock()

	if target == nil {
		return false
	}
	msg := SignalMessage{
		Type:          "host-credential",
		Payload:       payload,
		RoomID:        roomID,
		ParticipantID: "system",
		Timestamp:     time.Now().UnixMilli(),
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return false
	}
	return target.writeRaw(raw) == nil
}

// deliverCoHostCredential writes a private cohost-credential frame only to the
// target participant's authenticated signaling connection.
func (h *hub) deliverCoHostCredential(roomID, targetParticipantID string, payload json.RawMessage) bool {
	h.mu.Lock()
	room := h.rooms[roomID]
	var target *client
	for peer := range room {
		if peer.participantID == targetParticipantID {
			target = peer
			break
		}
	}
	h.mu.Unlock()

	if target == nil {
		return false
	}
	msg := SignalMessage{
		Type:          "cohost-credential",
		Payload:       payload,
		RoomID:        roomID,
		ParticipantID: "system",
		Timestamp:     time.Now().UnixMilli(),
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return false
	}
	return target.writeRaw(raw) == nil
}

func (h *hub) broadcastRoleChanged(roomID, participantID, role string) {
	msg := SignalMessage{
		Type: "role-changed",
		Payload: mustRawJSON(map[string]any{
			"participantId": participantID,
			"role":          role,
		}),
		RoomID:        roomID,
		ParticipantID: "system",
		Timestamp:     time.Now().UnixMilli(),
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for peer := range h.rooms[roomID] {
		_ = peer.writeRaw(raw)
	}
}

func (h *hub) broadcastDirective(roomID, senderID, action, targetParticipantID string) {
	msg := SignalMessage{
		Type: "directive",
		Payload: mustRawJSON(map[string]any{
			"action":              action,
			"targetParticipantId": targetParticipantID,
			"senderId":            senderID,
		}),
		RoomID:        roomID,
		ParticipantID: senderID,
		Timestamp:     time.Now().UnixMilli(),
	}
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for peer := range h.rooms[roomID] {
		_ = peer.writeRaw(raw)
	}
}

// stats returns the active room and connection count.
func (h *hub) stats() (rooms int, clients int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rooms = len(h.rooms)
	for _, m := range h.rooms {
		clients += len(m)
	}
	return
}

var (
	metricTokensIssued    int64
	metricMessagesRelayed int64
	metricSignalErrors    int64
)

var (
	jwtSecret        []byte
	jwtIssuer        string
	jwtTTL           time.Duration
	liveKitAPIKey    string
	liveKitAPISecret string
	liveKitURL       string
	sfuManagerURL    string
	liveKitTTL       time.Duration // 5 min default for LiveKit path

	sfuAddrCache = struct {
		mu   sync.RWMutex
		data map[string]cachedSFUAddr
	}{data: make(map[string]cachedSFUAddr)}
)

type cachedSFUAddr struct {
	addr      string
	expiresAt time.Time
}

var upgrader = websocket.Upgrader{
	// Local/P0 dev: any origin (prod would restrict to app origin).
	CheckOrigin: func(r *http.Request) bool { return true },
}

var (
	hostPrivateKey   *ecdsa.PrivateKey
	hostPublicKeyHex string
	authManager      = newAuthorityManager()
	sessionManager   = newSessionStore()
	resumeHandles    = newResumeHandleStore()
)

func initHostSigning() {
	var err error
	hostPrivateKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatalf("failed to generate host ECDSA key: %v", err)
	}
	pubBytes, err := x509.MarshalPKIXPublicKey(&hostPrivateKey.PublicKey)
	if err != nil {
		log.Fatalf("failed to marshal host public key: %v", err)
	}
	hostPublicKeyHex = hex.EncodeToString(pubBytes)
	log.Printf("host_auth: ECDSA P-256 signing initialized (pubkey_prefix=%s)", hostPublicKeyHex[:16]+"...")
}

type HostClaims struct {
	ParticipantID  string `json:"sub"`
	RoomID         string `json:"room"`
	Role           string `json:"role"`
	RoomInstanceID string `json:"rinst"`
	Generation     uint64 `json:"gen"`
	jwt.RegisteredClaims
}

func mintModerationToken(participantID, roomID, role, roomInstanceID string, generation uint64, ttl time.Duration) (string, error) {
	if hostPrivateKey == nil {
		return "", errors.New("host signing key not initialized")
	}
	now := time.Now()
	claims := HostClaims{
		ParticipantID:  participantID,
		RoomID:         roomID,
		Role:           role,
		RoomInstanceID: roomInstanceID,
		Generation:     generation,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   participantID,
			Audience:  jwt.ClaimStrings{roomID},
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			ID:        uuid.New().String(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	return token.SignedString(hostPrivateKey)
}

func mintHostToken(participantID, roomID, roomInstanceID string, generation uint64, ttl time.Duration) (string, error) {
	return mintModerationToken(participantID, roomID, "host", roomInstanceID, generation, ttl)
}

func mintCoHostToken(participantID, roomID, roomInstanceID string, generation uint64, ttl time.Duration) (string, error) {
	return mintModerationToken(participantID, roomID, "co-host", roomInstanceID, generation, ttl)
}

func validateModerationToken(tokenString string) (*HostClaims, error) {
	return validateHostToken(tokenString)
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	port := getEnv("PORT", "8080")
	metricsPort := "9091"

	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	jwtIssuer = getEnv("JWT_ISSUER", "meet-signal")
	jwtTTL = time.Duration(getEnvInt("JWT_TTL_SECONDS", 3600)) * time.Second

	// LiveKit configuration
	liveKitAPIKey = getEnv("LIVEKIT_API_KEY", "dev")
	liveKitAPISecret = os.Getenv("LIVEKIT_API_SECRET")
	liveKitURL = getEnv("LIVEKIT_URL", "") // empty = auto-derive from SFU manager
	sfuManagerURL = getEnv("SFU_MANAGER_URL", "http://meet-sfu-manager:8081")
	liveKitTTL = time.Duration(getEnvInt("LIVEKIT_TTL_SECONDS", 300)) * time.Second // 5 min default

	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET environment variable is required (min 32 bytes)")
	}
	// LIVEKIT_API_SECRET is optional for Phase 1 (dual-path); if set, must be ≥32 chars
	if liveKitAPISecret != "" && len(liveKitAPISecret) < 32 {
		log.Fatal("LIVEKIT_API_SECRET must be at least 32 characters when set")
	}

	initHostSigning()

	h := newHub()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(healthResponse{Status: "ok", Service: "meet-signal"})
	})
	mux.HandleFunc("/token", handleToken)
	mux.HandleFunc("/room/create", handleCreateRoom)
	mux.HandleFunc("/room/transfer-host", func(w http.ResponseWriter, r *http.Request) {
		handleTransferHost(h, authManager, w, r)
	})
	mux.HandleFunc("/room/directive", func(w http.ResponseWriter, r *http.Request) {
		handleDirective(h, authManager, w, r)
	})
	mux.HandleFunc("/room/assign-cohost", func(w http.ResponseWriter, r *http.Request) {
		handleAssignCoHost(h, authManager, w, r)
	})
	mux.HandleFunc("/room/revoke-cohost", func(w http.ResponseWriter, r *http.Request) {
		handleRevokeCoHost(h, authManager, w, r)
	})
	mux.HandleFunc("/room/authority", func(w http.ResponseWriter, r *http.Request) {
		handleRoomAuthority(authManager, w, r)
	})
	mux.HandleFunc("/room/status", func(w http.ResponseWriter, r *http.Request) {
		handleRoomStatus(authManager, w, r)
	})
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
		handleSignal(h, w, r)
	})
	mux.HandleFunc("/accounts/me", handleAccountDelete)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	mainServer := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}

	// Metrics server on 9091 (RED metrics: rate, errors, duration/gauges).
	metricsMux := http.NewServeMux()
	metricsMux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("# HELP meet_signal_info Service info\n"))
		w.Write([]byte("# TYPE meet_signal_info gauge\n"))
		w.Write([]byte(`meet_signal_info{service="meet-signal",version="w1-signal"} 1` + "\n"))

		rooms, conns := h.stats()
		fmt.Fprintf(w, "# HELP meet_signal_rooms_active Active signaling rooms\n")
		fmt.Fprintf(w, "# TYPE meet_signal_rooms_active gauge\n")
		fmt.Fprintf(w, "meet_signal_rooms_active %d\n", rooms)

		fmt.Fprintf(w, "# HELP meet_signal_connections_active Active client WebSocket connections\n")
		fmt.Fprintf(w, "# TYPE meet_signal_connections_active gauge\n")
		fmt.Fprintf(w, "meet_signal_connections_active %d\n", conns)

		fmt.Fprintf(w, "# HELP meet_signal_messages_total Total signaling frames relayed\n")
		fmt.Fprintf(w, "# TYPE meet_signal_messages_total counter\n")
		fmt.Fprintf(w, "meet_signal_messages_total %d\n", atomic.LoadInt64(&metricMessagesRelayed))

		fmt.Fprintf(w, "# HELP meet_signal_tokens_issued_total Total access tokens minted\n")
		fmt.Fprintf(w, "# TYPE meet_signal_tokens_issued_total counter\n")
		fmt.Fprintf(w, "meet_signal_tokens_issued_total %d\n", atomic.LoadInt64(&metricTokensIssued))

		fmt.Fprintf(w, "# HELP meet_signal_errors_total Total signaling errors encountered\n")
		fmt.Fprintf(w, "# TYPE meet_signal_errors_total counter\n")
		fmt.Fprintf(w, "meet_signal_errors_total %d\n", atomic.LoadInt64(&metricSignalErrors))
	})
	metricsServer := &http.Server{Addr: ":" + metricsPort, Handler: metricsMux, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second}

	go func() {
		log.Printf("meet-signal starting on :%s (signal/healthz), :%s (metrics)", port, metricsPort)
		if liveKitAPISecret != "" {
			log.Printf("LiveKit token issuance ENABLED (issuer=%s, ttl=%s)", liveKitAPIKey, liveKitTTL)
		} else {
			log.Printf("Legacy mesh token issuance (JWT_SECRET only)")
		}
		if err := mainServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("main server error: %v", err)
		}
	}()
	go func() {
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("metrics server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("Shutdown signal received, stopping servers...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = mainServer.Shutdown(ctx)
	_ = metricsServer.Shutdown(ctx)
	log.Println("Servers stopped gracefully")
}

// handleAccountDelete implements DSR (Data Subject Request) endpoint per P-02 D-033.
// DELETE /accounts/me with Authorization: Bearer <jwt> — erases hash-only account data.
// Currently meet-signal is stateless (JWT only, no persistent account store).
// When PG/Redis integration lands, this will delete presence:{roomId}:{hash} and PG participant rows.
func handleAccountDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	token := strings.TrimPrefix(auth, "Bearer ")

	claims, err := validateAccessToken(token)
	if err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// P-02 DSR: Hash-only erasure. meet-signal currently holds no persistent account data
	// (in-memory hub only, JWT is stateless). When PG/Redis wired:
	// - Redis: DEL presence:{roomId}:{participantHash} (TTL 24h already)
	// - PG: DELETE FROM participants WHERE participant_id_hash = hash(claims.ParticipantID)
	// - MinIO: presigned delete for any client-encrypted blobs (not in P0 scope)

	log.Printf("DSR: account deletion requested for participant hash %s", claims.ParticipantID[:8]+"****")

	w.WriteHeader(http.StatusNoContent)
}

func handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RoomID string `json:"roomId,omitempty"`
		Name   string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "display name is required", http.StatusBadRequest)
		return
	}
	if len(name) > 64 {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "display name too long", http.StatusBadRequest)
		return
	}

	roomID := canonicalRoomID(req.RoomID)
	if roomID == "" {
		roomID = "room-" + uuid.New().String()[:12]
	}
	if len(roomID) > 64 {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId too long", http.StatusBadRequest)
		return
	}

	participantID := "p-" + uuid.New().String()[:8]
	atomic.AddInt64(&metricTokensIssued, 1)

	// Authoritative Room Creation & Host Election
	auth, err := authManager.createRoom(roomID, participantID)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	role := "host"
	hostToken, err := mintHostToken(participantID, roomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
	if err != nil {
		log.Printf("create_room: failed to mint host token: %v", err)
	}

	// SEC-02B: issue the host's private session capability in the direct
	// bootstrap response. Never broadcast or log the raw capability.
	sessionToken, err := sessionManager.issue(participantID, auth.RoomInstanceID, "host", jwtTTL)
	if err != nil {
		log.Printf("create_room: failed to issue host session: %v", err)
	}
	// SEC-02C: issue a one-use, generation-bound host resume handle. The raw
	// handle is returned only in this direct bootstrap response.
	resumeHandle, err := resumeHandles.issue(participantID, auth.RoomInstanceID, auth.AuthorityGeneration, 1, jwtTTL)
	if err != nil {
		log.Printf("create_room: failed to issue host resume handle: %v", err)
	}

	if liveKitAPISecret != "" {
		issueLiveKitToken(w, participantID, roomID, name, role, hostToken, sessionToken, auth.RoomInstanceID, resumeHandle)
		return
	}
	issueLegacyToken(w, participantID, roomID, name, role, hostToken, sessionToken, auth.RoomInstanceID, resumeHandle)
}

func handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TokenRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.RoomID = canonicalRoomID(req.RoomID)
	name := strings.TrimSpace(req.Name)
	if req.RoomID == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId is required", http.StatusBadRequest)
		return
	}
	if len(req.RoomID) > 64 {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId too long", http.StatusBadRequest)
		return
	}

	authorization := headerValue(r.Header, "Authorization")
	sessionCapability := headerValue(r.Header, "X-Session-Capability")
	hostProof := headerValue(r.Header, "X-Host-Proof")
	resumeHandle := headerValue(r.Header, "X-Resume-Handle")

	// SEC-02B/C: the presence of any privileged credential header selects the
	// resume path, even when its value is empty or malformed. A failed
	// credential attempt fails closed and must never downgrade to guest issuance.
	if headerPresent(r.Header, "Authorization") || headerPresent(r.Header, "X-Session-Capability") ||
		headerPresent(r.Header, "X-Host-Proof") || headerPresent(r.Header, "X-Resume-Handle") {
		handleTokenResume(w, req, name, authorization, sessionCapability, hostProof, resumeHandle)
		return
	}

	if name == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "display name is required", http.StatusBadRequest)
		return
	}
	if len(name) > 64 {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "name too long", http.StatusBadRequest)
		return
	}

	participantID := "p-" + uuid.New().String()[:8]
	atomic.AddInt64(&metricTokensIssued, 1)

	// Register unknown rooms without granting authority. /token always issues a
	// participant credential, even if a generated ID collides with the host ID.
	authManager.assignRole(req.RoomID, participantID)
	role := "participant"

	// SEC-02B: issue a participant-purpose private session in the direct
	// bootstrap response so the identity can later be proven on privileged paths.
	auth, _ := authManager.getAuthority(req.RoomID)
	roomInstanceID := ""
	if auth != nil {
		roomInstanceID = auth.RoomInstanceID
	}
	sessionToken, err := sessionManager.issue(participantID, roomInstanceID, "participant", jwtTTL)
	if err != nil {
		log.Printf("token: failed to issue participant session: %v", err)
	}

	// Dual-path: LiveKit JWT with VideoGrant if LIVEKIT_API_SECRET is set, else legacy mesh token
	if liveKitAPISecret != "" {
		issueLiveKitToken(w, participantID, req.RoomID, name, role, "", sessionToken, roomInstanceID, "")
		return
	}
	issueLegacyToken(w, participantID, req.RoomID, name, role, "", sessionToken, roomInstanceID, "")
}

// handleTokenResume authenticates a credential-bearing /token request. The
// caller's identity is derived exclusively from the server-validated private
// session; the host operation proof never substitutes for it. On success it
// preserves the caller's identity, rotates the session capability, and for a
// current-generation host mints a fresh host token plus a replacement one-use
// resume handle.
func handleTokenResume(w http.ResponseWriter, req TokenRequest, name, authorization, sessionCapability, hostProof, resumeHandle string) {
	participantID, isHost, err := resumeIdentity(authManager, sessionManager, resumeHandles, req.RoomID, bearerToken(authorization), sessionCapability, bearerToken(hostProof), resumeHandle)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		writeAuthError(w, err)
		return
	}

	auth, ok := authManager.getAuthority(req.RoomID)
	if !ok {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	sessionToken, err := sessionManager.rotate(sessionCapability, jwtTTL)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		writeAuthError(w, err)
		return
	}

	atomic.AddInt64(&metricTokensIssued, 1)
	role := "participant"
	hostToken := ""
	newHandle := ""
	if isHost {
		role = "host"
		hostToken, err = mintHostToken(participantID, req.RoomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
		if err != nil {
			log.Printf("token: resume host signing failed: %v", err)
			http.Error(w, "signing failed", http.StatusInternalServerError)
			return
		}
		newHandle, err = resumeHandles.issue(participantID, auth.RoomInstanceID, auth.AuthorityGeneration, 1, jwtTTL)
		if err != nil {
			log.Printf("token: resume handle issuance failed: %v", err)
			http.Error(w, "signing failed", http.StatusInternalServerError)
			return
		}
	} else if authManager.getParticipantRole(req.RoomID, participantID) == RoleCoHost {
		role = "co-host"
		hostToken, err = mintCoHostToken(participantID, req.RoomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
		if err != nil {
			log.Printf("token: resume co-host signing failed: %v", err)
			http.Error(w, "signing failed", http.StatusInternalServerError)
			return
		}
	}
	if name == "" {
		name = "Participant"
	}
	if liveKitAPISecret != "" {
		issueLiveKitToken(w, participantID, req.RoomID, name, role, hostToken, sessionToken, auth.RoomInstanceID, newHandle)
		return
	}
	issueLegacyToken(w, participantID, req.RoomID, name, role, hostToken, sessionToken, auth.RoomInstanceID, newHandle)
}

func issueLiveKitToken(w http.ResponseWriter, participantID, roomID, name, role, hostToken, sessionToken, roomInstanceID, resumeHandle string) {
	now := time.Now()
	expiresAt := now.Add(liveKitTTL)

	// Determine LiveKit WS URL
	wsURL := getLiveKitWSURL(roomID)

	claims := LiveKitClaims{
		Video: LiveKitVideoGrant{
			RoomJoin:       true,
			Room:           roomID,
			CanPublish:     true,
			CanSubscribe:   true,
			CanPublishData: true,
		},
		Metadata: fmt.Sprintf(`{"role":"%s"}`, role),
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    liveKitAPIKey,
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
	signed, err := token.SignedString([]byte(liveKitAPISecret))
	if err != nil {
		log.Printf("token: livekit signing failed: %v", err)
		http.Error(w, "signing failed", http.StatusInternalServerError)
		return
	}

	// Sanitized log: only token prefix
	log.Printf("token: issued livekit token for participant=%s room=%s role=%s token_prefix=%s", participantID, roomID, role, signed[:16]+"...")

	coHostToken := ""
	if role == "co-host" {
		coHostToken = hostToken
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TokenResponse{
		Token:          signed,
		LiveKitToken:   signed,
		ParticipantID:  participantID,
		RoomID:         roomID,
		Role:           role,
		HostToken:      hostToken,
		CoHostToken:    coHostToken,
		HostKey:        hostPublicKeyHex,
		SessionToken:   sessionToken,
		ResumeHandle:   resumeHandle,
		RoomInstanceID: roomInstanceID,
		URL:            wsURL,
		SFUUrl:         wsURL,
	})
}

func issueLegacyToken(w http.ResponseWriter, participantID, roomID, name, role, hostToken, sessionToken, roomInstanceID, resumeHandle string) {
	now := time.Now()
	claims := Claims{
		ParticipantID: participantID,
		RoomID:        roomID,
		Name:          name,
		Role:          role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   participantID,
			Audience:  jwt.ClaimStrings{roomID},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(jwtTTL)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(jwtSecret)
	if err != nil {
		log.Printf("token: legacy signing failed: %v", err)
		http.Error(w, "signing failed", http.StatusInternalServerError)
		return
	}

	log.Printf("token: issued legacy mesh token for participant=%s room=%s role=%s token_prefix=%s", participantID, roomID, role, signed[:16]+"...")

	coHostToken := ""
	if role == "co-host" {
		coHostToken = hostToken
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TokenResponse{
		Token:          signed,
		LiveKitToken:   "",
		ParticipantID:  participantID,
		RoomID:         roomID,
		Role:           role,
		HostToken:      hostToken,
		CoHostToken:    coHostToken,
		HostKey:        hostPublicKeyHex,
		SessionToken:   sessionToken,
		ResumeHandle:   resumeHandle,
		RoomInstanceID: roomInstanceID,
		URL:            "",
		SFUUrl:         "",
	})
}

// getLiveKitWSURL returns the WebSocket URL for LiveKit connection.
// Uses SFU manager assignment if available, falls back to LIVEKIT_URL env or derived URL.
func getLiveKitWSURL(roomID string) string {
	// If LIVEKIT_URL is explicitly set, use it
	if liveKitURL != "" {
		return liveKitURL
	}

	// Otherwise, get SFU assignment and map to wss URL
	sfuAddr := getSFUAddr(roomID)
	// Map internal address (e.g., "livekit:7880") to external wss URL
	// In Compose, Caddy terminates TLS on 443 and proxies to livekit:7880
	// The external URL is wss://host/rtc (Caddy route) or wss://host:7880 if direct
	host := sfuAddr
	if strings.Contains(sfuAddr, ":") {
		host = strings.Split(sfuAddr, ":")[0]
	}
	// Default to wss://host/rtc (Caddy proxy path for LiveKit)
	return "wss://" + host + "/rtc"
}

// getSFUAddr fetches SFU assignment from meet-sfu-manager with 500ms timeout.
// Caches result for 5 seconds to reduce load on SFU manager.
func getSFUAddr(roomID string) string {
	// Check cache first
	sfuAddrCache.mu.RLock()
	if cached, ok := sfuAddrCache.data[roomID]; ok && time.Now().Before(cached.expiresAt) {
		sfuAddrCache.mu.RUnlock()
		return cached.addr
	}
	sfuAddrCache.mu.RUnlock()

	// Fetch from SFU manager with 500ms timeout
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sfuManagerURL+"/internal/sfu/assign?roomId="+roomID, nil)
	if err != nil {
		log.Printf("sfu_assign: request creation failed for room=%s: %v", roomID, err)
		return fallbackSFUAddr()
	}

	client := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("sfu_assign: request failed for room=%s: %v", roomID, err)
		return fallbackSFUAddr()
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("sfu_assign: non-200 status=%d for room=%s", resp.StatusCode, roomID)
		return fallbackSFUAddr()
	}

	var assignResp struct {
		NodeID string  `json:"nodeId"`
		Addr   string  `json:"addr"`
		Load   float64 `json:"load"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&assignResp); err != nil {
		log.Printf("sfu_assign: decode failed for room=%s: %v", roomID, err)
		return fallbackSFUAddr()
	}

	// Cache for 5 seconds
	sfuAddrCache.mu.Lock()
	sfuAddrCache.data[roomID] = cachedSFUAddr{
		addr:      assignResp.Addr,
		expiresAt: time.Now().Add(5 * time.Second),
	}
	sfuAddrCache.mu.Unlock()

	return assignResp.Addr
}

func fallbackSFUAddr() string {
	// Default to livekit:7880 as configured in compose
	return "livekit:7880"
}

// validateAccessToken authenticates an identity/signaling credential. Only
// HS256-signed tokens (legacy JWT_SECRET or LiveKit API secret) are accepted;
// ES256 host tokens are never valid access credentials.
func validateAccessToken(tokenString string) (*Claims, error) {
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, errors.New("empty access token")
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	})
	if err == nil && token.Valid {
		if claims.RoomID == "" {
			claims.RoomID = accessTokenRoom(claims)
		}
		if claims.ParticipantID != "" {
			claims.ParticipantID = strings.TrimSpace(claims.ParticipantID)
		} else if claims.Subject != "" {
			claims.ParticipantID = strings.TrimSpace(claims.Subject)
		}
		return claims, nil
	}

	if liveKitAPISecret != "" {
		claimsLK := &Claims{}
		token, err = jwt.ParseWithClaims(tokenString, claimsLK, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return []byte(liveKitAPISecret), nil
		})
		if err == nil && token.Valid {
			if claimsLK.RoomID == "" {
				claimsLK.RoomID = accessTokenRoom(claimsLK)
			}
			if claimsLK.ParticipantID != "" {
				claimsLK.ParticipantID = strings.TrimSpace(claimsLK.ParticipantID)
			} else if claimsLK.Subject != "" {
				claimsLK.ParticipantID = strings.TrimSpace(claimsLK.Subject)
			}
			return claimsLK, nil
		}
	}

	return nil, errors.New("invalid access token")
}

// validateHostToken authenticates a server-signed ES256 host-operation proof.
// It never accepts HS256 access credentials. The returned claims carry the
// room instance and authority generation used for generation-bound revocation.
func validateHostToken(tokenString string) (*HostClaims, error) {
	if hostPrivateKey == nil {
		return nil, errors.New("host signing not initialized")
	}
	claims := &HostClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodECDSA); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return &hostPrivateKey.PublicKey, nil
	})
	if err != nil || !token.Valid {
		return nil, errors.New("invalid host token")
	}
	return claims, nil
}

// accessTokenRoom returns the canonical room a token is bound to. Legacy claims
// carry a top-level "room" claim; LiveKit claims bind the room via video.room or
// the audience field. If multiple non-empty rooms are specified and conflict,
// returns empty string.
func accessTokenRoom(claims *Claims) string {
	room := canonicalRoomID(claims.RoomID)
	var videoRoom string
	if claims.Video != nil && claims.Video.Room != "" {
		videoRoom = canonicalRoomID(claims.Video.Room)
	}

	primaryRoom := room
	if primaryRoom == "" {
		primaryRoom = videoRoom
	} else if videoRoom != "" && primaryRoom != videoRoom {
		return "" // conflicting room and video.room
	}

	if len(claims.Audience) > 0 {
		if primaryRoom != "" {
			matched := false
			for _, a := range claims.Audience {
				if canonicalRoomID(a) == primaryRoom {
					matched = true
					break
				}
			}
			if !matched {
				return ""
			}
		} else {
			var nonServiceAuds []string
			for _, a := range claims.Audience {
				ca := canonicalRoomID(a)
				if ca == "" || ca == "meet-signal" || ca == "meet-signal-service" || ca == "latch-signal" || ca == "livekit" {
					continue
				}
				nonServiceAuds = append(nonServiceAuds, ca)
			}
			if len(nonServiceAuds) == 1 {
				primaryRoom = nonServiceAuds[0]
			}
		}
	}

	return primaryRoom
}

// resumeIdentity authenticates a /token resume attempt. It proves the caller's
// identity via an access token plus a private session capability, and reports
// whether that identity is the current host. A host resume additionally requires
// a valid ES256 host-operation proof and fails closed if it is missing.
//
// This is an SEC-02B identity-binding primitive used by handleTokenResume.
func resumeIdentity(am *authorityManager, ss *sessionStore, rh *resumeHandleStore, roomID, accessToken, sessionCapability, hostProof, resumeHandle string) (participantID string, isHost bool, err error) {
	roomID = canonicalRoomID(roomID)
	accessClaims, err := validateAccessToken(accessToken)
	if err != nil {
		return "", false, errPrivateSessionRequired
	}
	if accessTokenRoom(accessClaims) != roomID {
		return "", false, errIdentityMismatch
	}

	auth, ok := am.getAuthority(roomID)
	if !ok {
		return "", false, errors.New("room not found")
	}

	record, ok := ss.authenticate(sessionCapability)
	if !ok {
		return "", false, errPrivateSessionInvalid
	}
	if record.ParticipantID != accessClaims.ParticipantID || record.RoomInstanceID != auth.RoomInstanceID {
		return "", false, errIdentityMismatch
	}

	isHost = record.ParticipantID == auth.HostID
	if isHost {
		hostClaims, err := validateHostToken(hostProof)
		if err != nil {
			return "", false, errHostProofRequired
		}
		if hostClaims.ParticipantID != record.ParticipantID || hostClaims.RoomID != roomID || hostClaims.Role != "host" {
			return "", false, errIdentityMismatch
		}
		if hostClaims.Generation != auth.AuthorityGeneration || hostClaims.RoomInstanceID != auth.RoomInstanceID {
			return "", false, errIdentityMismatch
		}
		// Atomically re-check current authority and consume the one-use resume
		// handle bound to the current room instance and generation. Duplicate or
		// stale handles fail closed here.
		if _, ok := am.consumeResumeHandle(roomID, record.ParticipantID, rh, resumeHandle); !ok {
			return "", false, errResumeHandleInvalid
		}
	}
	return record.ParticipantID, isHost, nil
}

// transferHostIdentity authenticates a host transfer: the requester must prove
// it is the current host and the target must be an authenticated participant in
// the same room instance. On success it commits the transfer. It neither mints
// nor delivers credentials; the caller performs those steps privately.
//
// This is an SEC-02B identity-binding primitive used by handleTransferHost.
func transferHostIdentity(am *authorityManager, ss *sessionStore, roomID, accessToken, sessionCapability, hostProof, targetParticipantID string) error {
	roomID = canonicalRoomID(roomID)
	accessClaims, err := validateAccessToken(accessToken)
	if err != nil {
		return errPrivateSessionRequired
	}
	if accessTokenRoom(accessClaims) != roomID {
		return errIdentityMismatch
	}

	auth, ok := am.getAuthority(roomID)
	if !ok {
		return errors.New("room not found")
	}

	record, ok := ss.authenticate(sessionCapability)
	if !ok {
		return errPrivateSessionInvalid
	}
	if record.ParticipantID != accessClaims.ParticipantID || record.RoomInstanceID != auth.RoomInstanceID {
		return errIdentityMismatch
	}
	if record.ParticipantID != auth.HostID {
		return errIdentityMismatch
	}

	hostClaims, err := validateHostToken(hostProof)
	if err != nil {
		return errHostProofRequired
	}
	if hostClaims.ParticipantID != record.ParticipantID || hostClaims.RoomID != roomID || hostClaims.Role != "host" {
		return errIdentityMismatch
	}
	if hostClaims.Generation != auth.AuthorityGeneration || hostClaims.RoomInstanceID != auth.RoomInstanceID {
		return errIdentityMismatch
	}

	if targetParticipantID == "" || targetParticipantID == auth.HostID {
		return errTransferTargetUnauthenticated
	}
	if !ss.hasActiveSession(targetParticipantID, auth.RoomInstanceID) {
		return errTransferTargetUnauthenticated
	}

	// Commit via compare-and-swap on the expected generation. Concurrent
	// transfers based on a stale generation lose with errGenerationConflict.
	return am.transferHost(roomID, record.ParticipantID, targetParticipantID, hostClaims.Generation)
}

func handleTransferHost(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RoomID              string `json:"roomId"`
		TargetParticipantID string `json:"targetParticipantId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	req.RoomID = canonicalRoomID(req.RoomID)
	if req.RoomID == "" || req.TargetParticipantID == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId and targetParticipantId are required", http.StatusBadRequest)
		return
	}

	authorization := headerValue(r.Header, "Authorization")
	sessionCapability := headerValue(r.Header, "X-Session-Capability")
	hostProof := headerValue(r.Header, "X-Host-Proof")
	if !headerPresent(r.Header, "Authorization") || sessionCapability == "" || hostProof == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		writeAuthError(w, errPrivateSessionRequired)
		return
	}

	// Private delivery requires a live authenticated target connection. Refuse
	// before committing any authority transition if the target cannot receive
	// its credential; never fall back to a room-wide broadcast.
	if _, ok := h.clientByParticipant(req.RoomID, req.TargetParticipantID); !ok {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "transfer_target_unavailable", http.StatusServiceUnavailable)
		return
	}

	if err := transferHostIdentity(am, sessionManager, req.RoomID, bearerToken(authorization), sessionCapability, bearerToken(hostProof), req.TargetParticipantID); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		writeAuthError(w, err)
		return
	}

	auth, ok := am.getAuthority(req.RoomID)
	if !ok {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	atomic.AddInt64(&metricTokensIssued, 1)
	targetHostToken, err := mintHostToken(req.TargetParticipantID, req.RoomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
	if err != nil {
		log.Printf("transfer_host: target signing failed: %v", err)
		http.Error(w, "signing failed", http.StatusInternalServerError)
		return
	}
	targetHandle, err := resumeHandles.issue(req.TargetParticipantID, auth.RoomInstanceID, auth.AuthorityGeneration, 1, jwtTTL)
	if err != nil {
		log.Printf("transfer_host: target handle issuance failed: %v", err)
		http.Error(w, "signing failed", http.StatusInternalServerError)
		return
	}

	payload, err := json.Marshal(map[string]any{
		"hostToken":      targetHostToken,
		"hostKey":        hostPublicKeyHex,
		"roomInstanceId": auth.RoomInstanceID,
		"generation":     auth.AuthorityGeneration,
		"resumeHandle":   targetHandle,
	})
	if err != nil || !h.deliverHostCredential(req.RoomID, req.TargetParticipantID, payload) {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "credential_delivery_failed", http.StatusBadGateway)
		return
	}

	// Public metadata only: the new host credential is never returned to the
	// requester or broadcast to other peers.
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"roomId":     req.RoomID,
		"hostId":     req.TargetParticipantID,
		"hostKey":    hostPublicKeyHex,
		"generation": auth.AuthorityGeneration,
		"delivered":  true,
		"timestamp":  time.Now().UnixMilli(),
	})
}

func handleRoomAuthority(am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	roomID := canonicalRoomID(r.URL.Query().Get("roomId"))
	if roomID == "" {
		http.Error(w, "roomId is required", http.StatusBadRequest)
		return
	}

	auth, ok := am.getAuthority(roomID)
	if !ok {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	coHosts := make([]string, 0)
	if auth.CoHostIDs != nil {
		for cid := range auth.CoHostIDs {
			coHosts = append(coHosts, cid)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"roomId":    auth.RoomID,
		"hostId":    auth.HostID,
		"coHostIds": coHosts,
		"locked":    auth.Locked,
		"hostKey":   hostPublicKeyHex,
		"timestamp": time.Now().UnixMilli(),
	})
}

func handleRoomStatus(am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	roomID := canonicalRoomID(r.URL.Query().Get("roomId"))
	if roomID == "" {
		pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(pathParts) >= 2 && pathParts[0] == "room" && pathParts[len(pathParts)-1] == "status" {
			roomID = canonicalRoomID(pathParts[1])
		}
	}
	if roomID == "" {
		http.Error(w, "roomId is required", http.StatusBadRequest)
		return
	}

	auth, ok := am.getAuthority(roomID)
	w.Header().Set("Content-Type", "application/json")
	if !ok {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"roomId":   roomID,
			"exists":   false,
			"joinable": false,
			"locked":   false,
		})
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"roomId":   auth.RoomID,
		"exists":   true,
		"joinable": !auth.Locked,
		"locked":   auth.Locked,
	})
}

type DirectiveRequest struct {
	RoomID              string `json:"roomId"`
	Action              string `json:"action"`
	TargetParticipantID string `json:"targetParticipantId,omitempty"`
	ParticipantID       string `json:"participantId,omitempty"`
	Target              string `json:"target,omitempty"`
	ModerationToken     string `json:"moderationToken,omitempty"`
	HostToken           string `json:"hostToken,omitempty"`
}

func authenticateModerator(r *http.Request, am *authorityManager, roomID string, auth *RoomAuthority, reqModerationToken string) (string, Role, error) {
	if auth == nil {
		var ok bool
		auth, ok = am.getAuthority(roomID)
		if !ok {
			return "", RoleParticipant, errors.New("unauthorized: room authority not found")
		}
	}

	// Helper to validate ES256 HostClaims against current room authority
	validateHostClaims := func(claims *HostClaims) error {
		if claims.ParticipantID == "" {
			return errors.New("unauthorized: missing participant ID in token")
		}
		if canonicalRoomID(claims.RoomID) != roomID {
			return errors.New("unauthorized: token room mismatch")
		}
		if claims.RoomInstanceID != auth.RoomInstanceID {
			return errors.New("unauthorized: room instance mismatch")
		}
		if claims.Generation != auth.AuthorityGeneration {
			return errors.New("unauthorized: stale authority generation")
		}
		return nil
	}

	// 1. Check ModerationToken from body or X-Host-Proof header
	tokenStr := reqModerationToken
	if tokenStr == "" {
		tokenStr = headerValue(r.Header, "X-Host-Proof")
	}
	if tokenStr != "" {
		hostClaims, err := validateHostToken(bearerToken(tokenStr))
		if err != nil {
			return "", RoleParticipant, errors.New("unauthorized: invalid host token signature")
		}
		if err := validateHostClaims(hostClaims); err != nil {
			return "", RoleParticipant, err
		}
		pID := hostClaims.ParticipantID
		serverRole := am.getParticipantRole(roomID, pID)
		return pID, serverRole, nil
	}

	// 2. Check Authorization header
	authHeader := headerValue(r.Header, "Authorization")
	if authHeader != "" {
		rawToken := bearerToken(authHeader)
		// First try ES256 host/co-host token
		if hostClaims, err := validateHostToken(rawToken); err == nil {
			if err := validateHostClaims(hostClaims); err != nil {
				return "", RoleParticipant, err
			}
			pID := hostClaims.ParticipantID
			serverRole := am.getParticipantRole(roomID, pID)
			return pID, serverRole, nil
		}
		// Try HS256 access token
		if accessClaims, err := validateAccessToken(rawToken); err == nil {
			if accessClaims.ParticipantID == "" {
				return "", RoleParticipant, errors.New("unauthorized: missing participant ID in token")
			}
			if accessTokenRoom(accessClaims) != roomID {
				return "", RoleParticipant, errors.New("unauthorized: token room mismatch")
			}
			pID := accessClaims.ParticipantID
			serverRole := am.getParticipantRole(roomID, pID)
			return pID, serverRole, nil
		}
		return "", RoleParticipant, errors.New("unauthorized: invalid bearer token")
	}

	// Step 3 (X-Participant-ID header bypass) is COMPLETELY REMOVED.
	return "", RoleParticipant, errors.New("unauthorized: missing authentication credentials")
}

func authorizeAction(am *authorityManager, roomID, requesterID string, requesterRole Role, action Action, targetParticipantID string) error {
	// 1. Evaluate requester role against permission matrix
	switch action {
	case ActionAssignCoHost, ActionRevokeCoHost, ActionTransferHost, ActionEndMeeting:
		// STRICT: ONLY HOST can execute these actions
		if requesterRole != RoleHost {
			return errors.New("forbidden: only host may execute " + string(action))
		}
	case ActionMuteParticipant, ActionRemoveParticipant, ActionSpotlightParticipant,
		ActionAdmitParticipant, ActionRejectParticipant, ActionLockMeeting,
		ActionManageWaitingRoom, ActionStopParticipantShare, ActionUpdatePermissions:
		// HOST and CO-HOST permitted
		if requesterRole != RoleHost && requesterRole != RoleCoHost {
			return errors.New("forbidden: action requires host or co-host role")
		}
	default:
		// Other moderation directives
		if requesterRole != RoleHost && requesterRole != RoleCoHost {
			return errors.New("forbidden: unauthorized moderation action")
		}
	}

	// 2. Target Hierarchy Guardrail:
	// A CO-HOST cannot moderate an attendee of equal or higher tier (HOST or another CO-HOST).
	// A PARTICIPANT cannot moderate anyone (already rejected above).
	if targetParticipantID != "" && targetParticipantID != requesterID {
		targetRole := am.getParticipantRole(roomID, targetParticipantID)
		reqRank := roleHierarchy[requesterRole]
		targetRank := roleHierarchy[targetRole]

		if requesterRole == RoleCoHost && targetRank >= reqRank {
			return errors.New("forbidden: co-host cannot moderate participant of equal or higher tier")
		}

		if requesterRole != RoleHost && targetRank >= reqRank {
			return errors.New("forbidden: target tier equal or exceeds requester tier")
		}
	}

	return nil
}

func executeDirective(h *hub, am *authorityManager, roomID, requesterID string, action Action, targetParticipantID string, w http.ResponseWriter) {
	auth, ok := am.getAuthority(roomID)
	if !ok {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	switch action {
	case ActionAssignCoHost:
		if err := am.assignCoHost(roomID, requesterID, targetParticipantID); err != nil {
			atomic.AddInt64(&metricSignalErrors, 1)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var coHostToken string
		if hostPrivateKey != nil {
			tok, err := mintCoHostToken(targetParticipantID, roomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
			if err == nil {
				coHostToken = tok
				payload := mustRawJSON(map[string]any{
					"coHostToken":    coHostToken,
					"hostKey":        hostPublicKeyHex,
					"roomInstanceId": auth.RoomInstanceID,
					"generation":     auth.AuthorityGeneration,
				})
				if h != nil {
					_ = h.deliverCoHostCredential(roomID, targetParticipantID, payload)
				}
			}
		}
		if h != nil {
			h.broadcastRoleChanged(roomID, targetParticipantID, "co-host")
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success":             true,
			"action":              string(action),
			"roomId":              roomID,
			"targetParticipantId": targetParticipantID,
			"role":                "co-host",
			"timestamp":           time.Now().UnixMilli(),
		})

	case ActionRevokeCoHost:
		if err := am.revokeCoHost(roomID, requesterID, targetParticipantID); err != nil {
			atomic.AddInt64(&metricSignalErrors, 1)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if h != nil {
			h.broadcastRoleChanged(roomID, targetParticipantID, "participant")
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success":             true,
			"action":              string(action),
			"roomId":              roomID,
			"targetParticipantId": targetParticipantID,
			"role":                "participant",
			"timestamp":           time.Now().UnixMilli(),
		})

	case ActionLockMeeting:
		am.mu.Lock()
		if a, exists := am.rooms[roomID]; exists {
			a.Locked = true
		}
		am.mu.Unlock()
		if h != nil {
			h.broadcastDirective(roomID, requesterID, string(action), targetParticipantID)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success":   true,
			"action":    string(action),
			"roomId":    roomID,
			"locked":    true,
			"timestamp": time.Now().UnixMilli(),
		})

	default:
		// muteParticipant, removeParticipant, spotlightParticipant, stopParticipantShare, etc.
		if h != nil {
			h.broadcastDirective(roomID, requesterID, string(action), targetParticipantID)
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{
			"success":             true,
			"action":              string(action),
			"roomId":              roomID,
			"targetParticipantId": targetParticipantID,
			"timestamp":           time.Now().UnixMilli(),
		})
	}
}

func handleDirectiveWithRequest(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request, req DirectiveRequest) {
	roomID := canonicalRoomID(req.RoomID)
	if roomID == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId is required", http.StatusBadRequest)
		return
	}
	action := canonicalAction(req.Action)
	if string(action) == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "action is required", http.StatusBadRequest)
		return
	}

	auth, ok := am.getAuthority(roomID)
	if !ok {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	requesterID, requesterRole, err := authenticateModerator(r, am, roomID, auth, req.ModerationToken)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	targetID := strings.TrimSpace(req.TargetParticipantID)
	if targetID == "" {
		targetID = strings.TrimSpace(req.ParticipantID)
	}
	if targetID == "" {
		targetID = strings.TrimSpace(req.Target)
	}

	if err := authorizeAction(am, roomID, requesterID, requesterRole, action, targetID); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	executeDirective(h, am, roomID, requesterID, action, targetID, w)
}

func handleDirective(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req DirectiveRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.TargetParticipantID == "" && req.ParticipantID != "" {
		req.TargetParticipantID = req.ParticipantID
	}
	if req.TargetParticipantID == "" && req.Target != "" {
		req.TargetParticipantID = req.Target
	}
	if req.ModerationToken == "" && req.HostToken != "" {
		req.ModerationToken = req.HostToken
	}
	handleDirectiveWithRequest(h, am, w, r, req)
}

func handleAssignCoHost(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		RoomID              string `json:"roomId"`
		TargetParticipantID string `json:"targetParticipantId"`
		ParticipantID       string `json:"participantId"`
		Target              string `json:"target"`
		ModerationToken     string `json:"moderationToken"`
		HostToken           string `json:"hostToken"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	targetID := req.TargetParticipantID
	if targetID == "" {
		targetID = req.ParticipantID
	}
	if targetID == "" {
		targetID = req.Target
	}
	modToken := req.ModerationToken
	if modToken == "" {
		modToken = req.HostToken
	}
	dReq := DirectiveRequest{
		RoomID:              req.RoomID,
		Action:              string(ActionAssignCoHost),
		TargetParticipantID: targetID,
		ModerationToken:     modToken,
	}
	handleDirectiveWithRequest(h, am, w, r, dReq)
}

func handleRevokeCoHost(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		RoomID              string `json:"roomId"`
		TargetParticipantID string `json:"targetParticipantId"`
		ParticipantID       string `json:"participantId"`
		Target              string `json:"target"`
		ModerationToken     string `json:"moderationToken"`
		HostToken           string `json:"hostToken"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	targetID := req.TargetParticipantID
	if targetID == "" {
		targetID = req.ParticipantID
	}
	if targetID == "" {
		targetID = req.Target
	}
	modToken := req.ModerationToken
	if modToken == "" {
		modToken = req.HostToken
	}
	dReq := DirectiveRequest{
		RoomID:              req.RoomID,
		Action:              string(ActionRevokeCoHost),
		TargetParticipantID: targetID,
		ModerationToken:     modToken,
	}
	handleDirectiveWithRequest(h, am, w, r, dReq)
}

func handleSignal(h *hub, w http.ResponseWriter, r *http.Request) {
	token := ""
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		token = strings.TrimSpace(auth[7:])
	}
	if token == "" {
		protocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
		for _, p := range protocols {
			p = strings.TrimSpace(p)
			if p != "meet-token" && p != "" {
				token = p
			}
		}
	}

	claims, err := validateAccessToken(token)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if strings.TrimSpace(claims.ParticipantID) == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid token claims", http.StatusUnauthorized)
		return
	}

	claimRoom := canonicalRoomID(accessTokenRoom(claims))
	if claimRoom == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "invalid token claims", http.StatusUnauthorized)
		return
	}

	roomID := canonicalRoomID(r.URL.Query().Get("room"))
	if roomID == "" {
		roomID = claimRoom
	}
	if roomID != claimRoom {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room mismatch", http.StatusForbidden)
		return
	}

	// We must return the subprotocol we accepted if the client sent one.
	respHeader := http.Header{}
	if r.Header.Get("Sec-WebSocket-Protocol") != "" {
		// Just echo back what they sent to satisfy browser
		respHeader.Set("Sec-WebSocket-Protocol", r.Header.Get("Sec-WebSocket-Protocol"))
	}

	conn, err := upgrader.Upgrade(w, r, respHeader)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		return
	}
	defer conn.Close()

	c := &client{conn: conn, participantID: claims.ParticipantID}

	type joinPayload struct {
		ParticipantID string `json:"participantId"`
	}

	existing := h.join(roomID, c)
	defer h.leave(roomID, c)

	// Presence exchange: announce the newcomer to existing peers, and existing
	// peers to the newcomer, so both sides populate their participant rosters.
	for _, peer := range existing {
		_ = peer.writeJSON(SignalMessage{
			Type:          "join",
			Payload:       mustRawJSON(joinPayload{ParticipantID: claims.ParticipantID}),
			RoomID:        roomID,
			ParticipantID: claims.ParticipantID,
			Timestamp:     time.Now().UnixMilli(),
		})
		_ = c.writeJSON(SignalMessage{
			Type:          "join",
			Payload:       mustRawJSON(joinPayload{ParticipantID: peer.participantID}),
			RoomID:        roomID,
			ParticipantID: peer.participantID,
			Timestamp:     time.Now().UnixMilli(),
		})
	}

	readLoop(h, roomID, c)
}

func readLoop(h *hub, roomID string, c *client) {
	readLoopWithAuth(h, authManager, roomID, c)
}

func readLoopWithAuth(h *hub, am *authorityManager, roomID string, c *client) {
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		var msg SignalMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			atomic.AddInt64(&metricSignalErrors, 1)
			continue
		}

		// Intercept moderation frames (including top-level actions)
		isModerationFrame := msg.Type == "host-directive" || msg.Type == "directive" || msg.Type == "moderation-directive" ||
			msg.Type == "mute-participant" || msg.Type == "remove-participant" || msg.Type == "spotlight-participant" ||
			msg.Type == "stop-participant-share" || msg.Type == "stopParticipantShare" ||
			msg.Type == "lock-room" || msg.Type == "lockMeeting" ||
			msg.Type == "update-permissions" || msg.Type == "updatePermissions" ||
			msg.Type == "assign-cohost" || msg.Type == "assignCoHost" ||
			msg.Type == "revoke-cohost" || msg.Type == "revokeCoHost"

		var directivePayload struct {
			Action              string `json:"action"`
			TargetParticipantID string `json:"targetParticipantId"`
			ParticipantID       string `json:"participantId"`
			Target              string `json:"target"`
			HostToken           string `json:"hostToken"`
			ModerationToken     string `json:"moderationToken"`
		}
		if len(msg.Payload) > 0 {
			_ = json.Unmarshal(msg.Payload, &directivePayload)
		}

		if msg.Type == "mute" {
			targetID := directivePayload.TargetParticipantID
			if targetID == "" {
				targetID = directivePayload.ParticipantID
			}
			if targetID != "" && targetID != c.participantID {
				isModerationFrame = true
				if directivePayload.Action == "" {
					directivePayload.Action = "muteParticipant"
				}
			}
		}

		if isModerationFrame {
			actionStr := directivePayload.Action
			if actionStr == "" {
				actionStr = msg.Type
			}
			action := canonicalAction(actionStr)

			targetID := directivePayload.TargetParticipantID
			if targetID == "" {
				targetID = directivePayload.ParticipantID
			}
			if targetID == "" {
				targetID = directivePayload.Target
			}

			senderRole := am.getParticipantRole(roomID, c.participantID)
			if err := authorizeAction(am, roomID, c.participantID, senderRole, action, targetID); err != nil {
				atomic.AddInt64(&metricSignalErrors, 1)
				_ = c.writeJSON(SignalMessage{
					Type:          "error",
					Payload:       mustRawJSON(map[string]any{"code": 403, "error": "forbidden"}),
					RoomID:        roomID,
					ParticipantID: "system",
					Timestamp:     time.Now().UnixMilli(),
				})
				continue // Drop unauthorized frame before peer relay
			}

			// Authorized state modifications
			if action == ActionAssignCoHost && targetID != "" {
				_ = am.assignCoHost(roomID, c.participantID, targetID)
				if hostPrivateKey != nil {
					if auth, ok := am.getAuthority(roomID); ok {
						tok, err := mintCoHostToken(targetID, roomID, auth.RoomInstanceID, auth.AuthorityGeneration, jwtTTL)
						if err == nil {
							payload := mustRawJSON(map[string]any{
								"coHostToken":    tok,
								"hostKey":        hostPublicKeyHex,
								"roomInstanceId": auth.RoomInstanceID,
								"generation":     auth.AuthorityGeneration,
							})
							if h != nil {
								_ = h.deliverCoHostCredential(roomID, targetID, payload)
							}
						}
					}
				}
				if h != nil {
					h.broadcastRoleChanged(roomID, targetID, "co-host")
				}
			} else if action == ActionRevokeCoHost && targetID != "" {
				_ = am.revokeCoHost(roomID, c.participantID, targetID)
				if h != nil {
					h.broadcastRoleChanged(roomID, targetID, "participant")
				}
			} else if action == ActionLockMeeting {
				am.mu.Lock()
				if a, ok := am.rooms[roomID]; ok {
					a.Locked = true
				}
				am.mu.Unlock()
			}
		}

		// Enforce authenticated identity + room, then relay to peers.
		msg.ParticipantID = c.participantID
		msg.RoomID = roomID
		if len(msg.Payload) == 0 {
			msg.Payload = json.RawMessage(`{}`)
		}
		out, err := json.Marshal(msg)
		if err != nil {
			atomic.AddInt64(&metricSignalErrors, 1)
			continue
		}

		atomic.AddInt64(&metricMessagesRelayed, 1)
		for _, peer := range h.peers(roomID, c) {
			_ = peer.writeRaw(out)
		}
	}

	// Announce departure.
	pay := mustRawJSON(struct {
		ParticipantID string `json:"participantId"`
	}{ParticipantID: c.participantID})
	for _, peer := range h.peers(roomID, c) {
		_ = peer.writeJSON(SignalMessage{
			Type:          "leave",
			Payload:       pay,
			RoomID:        roomID,
			ParticipantID: c.participantID,
			Timestamp:     time.Now().UnixMilli(),
		})
	}
}

func mustRawJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return b
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
