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
	"crypto/x509"
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
	ParticipantID string `json:"sub"`
	RoomID        string `json:"room"`
	Name          string `json:"name"`
	Role          string `json:"role,omitempty"`
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
	RoomJoin     bool   `json:"roomJoin"`
	Room         string `json:"room"`
	CanPublish   bool   `json:"canPublish"`
	CanSubscribe bool   `json:"canSubscribe"`
	CanPublishData bool `json:"canPublishData"`
}

type TokenRequest struct {
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

type TokenResponse struct {
	Token         string `json:"token"`                  // Legacy mesh token / LiveKit JWT (backward compat)
	LiveKitToken  string `json:"livekitToken"`           // Alias for token when LiveKit path is used
	ParticipantID string `json:"participantId"`
	RoomID        string `json:"roomId"`
	Role          string `json:"role"`                   // M4A: "host" or "participant"
	HostToken     string `json:"hostToken,omitempty"`    // M4A: Server-signed ES256 host claim (if role == "host")
	HostKey       string `json:"hostKey,omitempty"`      // M4A: Public key in hex for peer verification
	URL           string `json:"url,omitempty"`          // Legacy field (backward compat)
	SFUUrl        string `json:"sfuUrl,omitempty"`        // Alias for url when LiveKit path is used
}

type RoomAuthority struct {
	RoomID        string    `json:"roomId"`
	HostID        string    `json:"hostId"`
	CreatedAt     time.Time `json:"createdAt"`
	HostUpdatedAt time.Time `json:"hostUpdatedAt"`
	GraceExpiry   time.Time `json:"graceExpiry,omitempty"`
	Locked        bool      `json:"locked"`
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

func (am *authorityManager) createRoom(roomID, creatorID string) (*RoomAuthority, error) {
	am.mu.Lock()
	defer am.mu.Unlock()

	now := time.Now()
	auth, exists := am.rooms[roomID]
	if exists && auth.HostID != "" && (auth.GraceExpiry.IsZero() || auth.GraceExpiry.After(now)) {
		return nil, errors.New("room already exists with active host")
	}

	auth = &RoomAuthority{
		RoomID:        roomID,
		HostID:        creatorID,
		CreatedAt:     now,
		HostUpdatedAt: now,
		Locked:        false,
	}
	am.rooms[roomID] = auth
	return auth, nil
}

func (am *authorityManager) assignRole(roomID, participantID string, isHostReconn ...bool) (string, bool) {
	am.mu.Lock()
	defer am.mu.Unlock()

	isHost := false
	if len(isHostReconn) > 0 && isHostReconn[0] {
		isHost = true
	}

	auth, exists := am.rooms[roomID]
	now := time.Now()
	if !exists {
		// Room not created via /room/create — register unhosted room
		am.rooms[roomID] = &RoomAuthority{
			RoomID:        roomID,
			HostID:        "",
			CreatedAt:     now,
			HostUpdatedAt: now,
		}
		return "participant", false
	}

	if isHost || (auth.HostID != "" && auth.HostID == participantID) {
		auth.HostID = participantID
		auth.GraceExpiry = time.Time{}
		return "host", false
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
	return &copy, true
}

func (am *authorityManager) transferHost(roomID, requesterID, targetParticipantID string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	auth, exists := am.rooms[roomID]
	if !exists {
		return errors.New("room not found")
	}
	if auth.HostID != requesterID {
		return errors.New("unauthorized: requester is not host")
	}
	auth.HostID = targetParticipantID
	auth.HostUpdatedAt = time.Now()
	auth.GraceExpiry = time.Time{}
	return nil
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
		if onTimeout != nil {
			go onTimeout(roomID)
		}
	}()
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
	jwtSecret       []byte
	jwtIssuer       string
	jwtTTL          time.Duration
	liveKitAPIKey   string
	liveKitAPISecret string
	liveKitURL      string
	sfuManagerURL   string
	liveKitTTL      time.Duration // 5 min default for LiveKit path

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
	ParticipantID string `json:"sub"`
	RoomID        string `json:"room"`
	Role          string `json:"role"`
	jwt.RegisteredClaims
}

func mintHostToken(participantID, roomID string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := HostClaims{
		ParticipantID: participantID,
		RoomID:        roomID,
		Role:          "host",
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

	claims, err := validateJWT(token)
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
	_, err := authManager.createRoom(roomID, participantID)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}

	role := "host"
	hostToken, err := mintHostToken(participantID, roomID, jwtTTL)
	if err != nil {
		log.Printf("create_room: failed to mint host token: %v", err)
	}

	if liveKitAPISecret != "" {
		issueLiveKitToken(w, participantID, roomID, name, role, hostToken)
		return
	}
	issueLegacyToken(w, participantID, roomID, name, role, hostToken)
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
	if name == "" {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "display name is required", http.StatusBadRequest)
		return
	}
	if len(req.RoomID) > 64 || len(name) > 64 {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "roomId/name too long", http.StatusBadRequest)
		return
	}

	// Check if reconnecting with an existing server-issued host token
	isHostReconnection := false
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := validateJWT(tokenStr)
		if err == nil && canonicalRoomID(claims.RoomID) == req.RoomID && claims.Role == "host" {
			isHostReconnection = true
		}
	}

	participantID := "p-" + uuid.New().String()[:8]
	atomic.AddInt64(&metricTokensIssued, 1)

	// M4A: Attendees/guests calling /token receive "participant" role.
	// Only reconnecting hosts (authenticated via server signature) retain "host".
	role, _ := authManager.assignRole(req.RoomID, participantID, isHostReconnection)
	var hostToken string
	if role == "host" {
		var err error
		hostToken, err = mintHostToken(participantID, req.RoomID, jwtTTL)
		if err != nil {
			log.Printf("token: failed to mint host token: %v", err)
		}
	}

	// Dual-path: LiveKit JWT with VideoGrant if LIVEKIT_API_SECRET is set, else legacy mesh token
	if liveKitAPISecret != "" {
		issueLiveKitToken(w, participantID, req.RoomID, name, role, hostToken)
		return
	}
	issueLegacyToken(w, participantID, req.RoomID, name, role, hostToken)
}

func issueLiveKitToken(w http.ResponseWriter, participantID, roomID, name, role, hostToken string) {
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TokenResponse{
		Token:         signed,
		LiveKitToken:  signed,
		ParticipantID: participantID,
		RoomID:        roomID,
		Role:          role,
		HostToken:     hostToken,
		HostKey:       hostPublicKeyHex,
		URL:           wsURL,
		SFUUrl:        wsURL,
	})
}

func issueLegacyToken(w http.ResponseWriter, participantID, roomID, name, role, hostToken string) {
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TokenResponse{
		Token:         signed,
		LiveKitToken:  "",
		ParticipantID: participantID,
		RoomID:        roomID,
		Role:          role,
		HostToken:     hostToken,
		HostKey:       hostPublicKeyHex,
		URL:           "",
		SFUUrl:        "",
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

func validateJWT(tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); ok {
			return jwtSecret, nil
		}
		if _, ok := t.Method.(*jwt.SigningMethodECDSA); ok && hostPrivateKey != nil {
			return &hostPrivateKey.PublicKey, nil
		}
		return nil, errors.New("unexpected signing method")
	})
	if err == nil && token.Valid {
		return claims, nil
	}

	// Try LiveKit secret if configured
	if liveKitAPISecret != "" {
		token, err = jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, errors.New("unexpected signing method")
			}
			return []byte(liveKitAPISecret), nil
		})
		if err == nil && token.Valid {
			return claims, nil
		}
	}

	return nil, errors.New("invalid token")
}

func handleTransferHost(h *hub, am *authorityManager, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")

	claims, err := validateJWT(tokenStr)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	var req struct {
		RoomID              string `json:"roomId"`
		TargetParticipantID string `json:"targetParticipantId"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.RoomID == "" || req.TargetParticipantID == "" {
		http.Error(w, "roomId and targetParticipantId required", http.StatusBadRequest)
		return
	}
	req.RoomID = canonicalRoomID(req.RoomID)

	// Verify requester is host
	if err := am.transferHost(req.RoomID, claims.ParticipantID, req.TargetParticipantID); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	// Mint new host token for target
	newHostToken, err := mintHostToken(req.TargetParticipantID, req.RoomID, jwtTTL)
	if err != nil {
		http.Error(w, "failed to mint new host token", http.StatusInternalServerError)
		return
	}

	// Broadcast host-changed to room hub
	broadcastPayload, _ := json.Marshal(map[string]any{
		"action":       "host-changed",
		"newHostId":    req.TargetParticipantID,
		"newHostToken": newHostToken,
		"hostKey":      hostPublicKeyHex,
		"timestamp":    time.Now().UnixMilli(),
	})
	sigMsg := SignalMessage{
		Type:          "host-changed",
		Payload:       broadcastPayload,
		RoomID:        req.RoomID,
		ParticipantID: "system",
		Timestamp:     time.Now().UnixMilli(),
	}
	rawMsg, _ := json.Marshal(sigMsg)
	for _, peer := range h.peers(req.RoomID, nil) {
		_ = peer.writeRaw(rawMsg)
	}

	log.Printf("host_transfer: room=%s transferred from %s to %s", req.RoomID, claims.ParticipantID, req.TargetParticipantID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":       "ok",
		"roomId":       req.RoomID,
		"hostId":       req.TargetParticipantID,
		"newHostToken": newHostToken,
		"hostKey":      hostPublicKeyHex,
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"roomId":    auth.RoomID,
		"hostId":    auth.HostID,
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

func handleSignal(h *hub, w http.ResponseWriter, r *http.Request) {
	// Accept token via query (?token=...) or Authorization: Bearer <token>.
	token := r.URL.Query().Get("token")
	if token == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}

	claims, err := validateJWT(token)
	if err != nil {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := canonicalRoomID(r.URL.Query().Get("room"))
	if roomID == "" {
		roomID = canonicalRoomID(claims.RoomID)
	}
	if roomID != canonicalRoomID(claims.RoomID) {
		atomic.AddInt64(&metricSignalErrors, 1)
		http.Error(w, "room mismatch", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
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