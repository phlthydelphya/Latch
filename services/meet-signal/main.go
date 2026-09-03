// meet-signal — W1 signaling service.
// Implements: POST /token (signed JWT), WSS /signal (authenticated relay),
// GET /healthz, GET /metrics (stub).
// Scope: JWT issuance + verification + in-room WebSocket relay. No refresh,
// OAuth, OIDC federation, key rotation, or JWKS (per M1 scope).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

// Claims is the minimal signed claim set used for signaling auth.
type Claims struct {
	ParticipantID string `json:"sub"`
	RoomID        string `json:"room"`
	Name          string `json:"name"`
	jwt.RegisteredClaims
}

type TokenRequest struct {
	RoomID string `json:"roomId"`
	Name   string `json:"name"`
}

type TokenResponse struct {
	Token         string `json:"token"`
	ParticipantID string `json:"participantId"`
	RoomID        string `json:"roomId"`
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

var (
	jwtSecret []byte
	jwtIssuer string
	jwtTTL    time.Duration

	upgrader = websocket.Upgrader{
		// Local/P0 dev: any origin (prod would restrict to app origin).
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	port := getEnv("PORT", "8080")
	metricsPort := "9091"

	jwtSecret = []byte(os.Getenv("JWT_SECRET"))
	jwtIssuer = getEnv("JWT_ISSUER", "meet-signal")
	jwtTTL = time.Duration(getEnvInt("JWT_TTL_SECONDS", 3600)) * time.Second

	if len(jwtSecret) < 32 {
		log.Fatal("JWT_SECRET environment variable is required (min 32 bytes)")
	}

	h := newHub()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(healthResponse{Status: "ok", Service: "meet-signal"})
	})
	mux.HandleFunc("/token", handleToken)
	mux.HandleFunc("/signal", func(w http.ResponseWriter, r *http.Request) {
		handleSignal(h, w, r)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	mainServer := &http.Server{Addr: ":" + port, Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}

	// Metrics server on 9091 (stub, parity with compose healthcheck).
	metricsMux := http.NewServeMux()
	metricsMux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("# HELP meet_signal_info Service info\n"))
		w.Write([]byte("# TYPE meet_signal_info gauge\n"))
		w.Write([]byte(`meet_signal_info{service="meet-signal",version="w1-signal"} 1` + "\n"))
	})
	metricsServer := &http.Server{Addr: ":" + metricsPort, Handler: metricsMux, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second}

	go func() {
		log.Printf("meet-signal starting on :%s (signal/healthz), :%s (metrics)", port, metricsPort)
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

func handleToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req TokenRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if req.RoomID == "" {
		http.Error(w, "roomId is required", http.StatusBadRequest)
		return
	}
	if len(req.RoomID) > 64 || len(req.Name) > 64 {
		http.Error(w, "roomId/name too long", http.StatusBadRequest)
		return
	}

	participantID := "p-" + uuid.New().String()[:8]

	now := time.Now()
	claims := Claims{
		ParticipantID: participantID,
		RoomID:        req.RoomID,
		Name:          req.Name,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   participantID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(jwtTTL)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(jwtSecret)
	if err != nil {
		log.Printf("token: signing failed: %v", err)
		http.Error(w, "signing failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TokenResponse{Token: signed, ParticipantID: participantID, RoomID: req.RoomID})
}

func validateJWT(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := r.URL.Query().Get("room")
	if roomID == "" {
		roomID = claims.RoomID
	}
	if roomID != claims.RoomID {
		http.Error(w, "room mismatch", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
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
			continue
		}

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

func (c *client) writeRaw(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(websocket.TextMessage, b)
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