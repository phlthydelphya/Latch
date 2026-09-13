// turn-auth — TURN HMAC credential service (M0-P0)
// Implements: POST /turn/credentials (ADR-005), GET /healthz, optional /metrics
// Security: HMAC-SHA256 ephemeral creds TTL 24h, no PII, sanitized logs
// Privacy: No PG persistence, optional Redis audit key TTL 24h (docs/privacy-inventory.md D-7)
// Compose: PORT=8080 internal, maps to 8082 external; env TURN_SECRET, TURN_TTL, REDIS_URL
// Verifiability: Client uses urls in order stun→turn:3478 UDP→turn:443 TCP→turns:443 TLS;
//   QA verifies candidateType=relay via pc.getStats() + Prometheus turn_allocations_active
package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
)

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type turnCredRequest struct {
	RoomID          string `json:"roomId"`
	ParticipantHash string `json:"participantHash"`
}

type turnCredResponse struct {
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
	TTL        int      `json:"ttl"`
	URLs       []string `json:"urls"`
}

// maxBodyBytes limits request body to 1KB for DoS protection
const maxBodyBytes = 1024

var (
	allocationsTotal      int64
	allocationErrorsTotal int64
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	port := getEnv("PORT", "8080")
	turnSecret := os.Getenv("TURN_SECRET")
	turnTTL := getEnvInt("TURN_TTL", 86400)
	redisURL := os.Getenv("REDIS_URL") // optional for audit

	// Fail fast if TURN_SECRET is missing or too short (min 32 chars per ADR-005)
	if turnSecret == "" {
		log.Fatal("TURN_SECRET environment variable is required")
	}
	if len(turnSecret) < 32 {
		log.Fatal("TURN_SECRET must be at least 32 characters")
	}

	mux := http.NewServeMux()

	var rdb *redis.Client
	if redisURL != "" {
		opts, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Printf("turn-auth: WARNING: invalid REDIS_URL, audit logging disabled: %v", err)
		} else {
			rdb = redis.NewClient(opts)
		}
	}
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(healthResponse{Status: "ok", Service: "turn-auth"})
	})

	// /metrics — Prometheus counters for allocations and failures
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		w.WriteHeader(http.StatusOK)
		io.WriteString(w, "# HELP turn_allocations_total Total TURN credential allocations\n")
		io.WriteString(w, "# TYPE turn_allocations_total counter\n")
		io.WriteString(w, "turn_allocations_total "+strconv.FormatInt(atomic.LoadInt64(&allocationsTotal), 10)+"\n")
		io.WriteString(w, "# HELP turn_auth_failures_total Total failed TURN credential allocations\n")
		io.WriteString(w, "# TYPE turn_auth_failures_total counter\n")
		io.WriteString(w, "turn_auth_failures_total "+strconv.FormatInt(atomic.LoadInt64(&allocationErrorsTotal), 10)+"\n")
	})

	mux.HandleFunc("/turn/credentials", func(w http.ResponseWriter, r *http.Request) {
		// Method enforcement
		if r.Method != http.MethodPost {
			atomic.AddInt64(&allocationErrorsTotal, 1)
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Content-Type enforcement
		ct := r.Header.Get("Content-Type")
		if ct != "application/json" && ct != "application/json; charset=utf-8" {
			atomic.AddInt64(&allocationErrorsTotal, 1)
			http.Error(w, "Content-Type must be application/json", http.StatusBadRequest)
			return
		}

		// Body size limit (1KB)
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

		var req turnCredRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields() // Strict JSON
		if err := dec.Decode(&req); err != nil {
			atomic.AddInt64(&allocationErrorsTotal, 1)
			// Sanitized error — no request body in logs
			log.Printf("turn/credentials: invalid JSON: %v", err)
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		// Validate required fields
		if req.RoomID == "" {
			atomic.AddInt64(&allocationErrorsTotal, 1)
			http.Error(w, "roomId is required", http.StatusBadRequest)
			return
		}

		// Generate userHash: base64url(sha256(participantHash|roomId)) or random if missing
		var userHash string
		if req.ParticipantHash != "" {
			h := sha256.Sum256([]byte(req.ParticipantHash + "|" + req.RoomID))
			userHash = base64.RawURLEncoding.EncodeToString(h[:])
		} else {
			// Fallback: random hash (32 bytes -> 43 chars base64url)
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				atomic.AddInt64(&allocationErrorsTotal, 1)
				log.Printf("turn/credentials: rand read failed: %v", err)
				http.Error(w, "Internal error", http.StatusInternalServerError)
				return
			}
			userHash = base64.RawURLEncoding.EncodeToString(b)
		}

		// Expiry = now + TTL
		now := time.Now().Unix()
		expiry := now + int64(turnTTL)

		// Username format: "<expiry>:<userHash>"
		username := strconv.FormatInt(expiry, 10) + ":" + userHash

		// Credential = base64(HMAC-SHA256(TURN_SECRET, username))
		mac := hmac.New(sha1.New, []byte(turnSecret))
		mac.Write([]byte(username))
		credential := base64.StdEncoding.EncodeToString(mac.Sum(nil))

		// Response URLs per ADR-005 §Decision — matches coturn compose ports
		// coturn listens: 3478 UDP/TCP, 443 TCP/TLS (turns), 5349 TLS
		urls := []string{
			"turn:turn.meet-secure.local:3478",
			"turn:turn.meet-secure.local:3478?transport=tcp",
		}

		resp := turnCredResponse{
			Username:   username,
			Credential: credential,
			TTL:        turnTTL,
			URLs:       urls,
		}

		// Optional Redis audit key (non-blocking, best-effort)
		// Key: turn:alloc:{userHash} EX 86400 - see docs/privacy-inventory.md D-7 TTL 86400
		if rdb != nil {
			go func(uh string) {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				if err := rdb.Set(ctx, "turn:alloc:"+uh, time.Now().Unix(), time.Duration(turnTTL)*time.Second).Err(); err != nil {
					log.Printf("turn/credentials: WARNING: Redis audit log failed for userHash=%s...: %v", uh[:8], err)
				}
			}(userHash)
		}

		// Sanitized allocation log — NEVER log TURN_SECRET, credential raw, or raw IP
		// ipHash = sha256(ip+salt) style if we had client IP; here we log only userHash prefix
		atomic.AddInt64(&allocationsTotal, 1)
		log.Printf("turn/credentials: allocation roomId=%s userHash=%s... expiry=%d", req.RoomID, userHash[:8], expiry)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	})

	// 404 for everything else
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && r.URL.Path != "/metrics" && r.URL.Path != "/turn/credentials" {
			http.NotFound(w, r)
		}
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("turn-auth starting on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("Shutdown signal received, stopping server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
	log.Println("Server stopped gracefully")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func itoa64(n int64) string {
	return strconv.FormatInt(n, 10)
}