// meet-sfu-manager — HRW rendezvous hashing for roomId→SFU assignment (M0-P0)
// Implements: GET /internal/sfu/assign?roomId=:id, GET /healthz, Redis cache sfu:assign:{roomId} EX 300,
// background health poll 5s to SFU /healthz, re-hash on health fail.
// Algorithm: h = xxhash(roomId|nodeID|salt) / weight, weight = 1+load*10
// Test vector: roomId=abc123, nodes=[sfu-0,sfu-1,sfu-2], salt="p0-salt-2026" → sfu-1
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/redis/go-redis/v9"
)

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

type assignResponse struct {
	NodeID string `json:"nodeId"`
	Addr   string `json:"addr"`
	Load   float64 `json:"load"`
}

type SFUNode struct {
	ID       string
	Addr     string
	Load     float64
	Healthy  bool
	mu       sync.RWMutex
}

func (n *SFUNode) setHealthy(h bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.Healthy = h
}

func (n *SFUNode) isHealthy() bool {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.Healthy
}

func (n *SFUNode) setLoad(l float64) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.Load = l
}

func (n *SFUNode) getLoad() float64 {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.Load
}

var (
	sfuNodes     []*SFUNode
	sfuNodesMu   sync.RWMutex
	redisClient  *redis.Client
	salt         string
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	port := getEnv("PORT", "8081")
	salt = getEnv("SFU_HASH_SALT", "p0-salt-2026")
	redisURL := getEnv("REDIS_URL", "redis://redis:6379/0")
	sfuNodesEnv := getEnv("SFU_NODES", "livekit:7880")

	// Parse SFU_NODES comma-separated list: "sfu-0:7880,sfu-1:7880,sfu-2:7880"
	sfuNodes = parseSFUNodes(sfuNodesEnv)
	log.Printf("SFU nodes configured: %v", getNodeIDs(sfuNodes))

	// Initialize Redis client
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Invalid REDIS_URL: %v", err)
	}
	redisClient = redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Redis connection failed: %v", err)
	}
	log.Println("Redis connected")

	// Start background health polling (5s interval)
	go healthPollLoop(ctx)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(healthResponse{Status: "ok", Service: "meet-sfu-manager"})
	})

	mux.HandleFunc("/internal/sfu/assign", handleAssign)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && r.URL.Path != "/internal/sfu/assign" {
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
		log.Printf("meet-sfu-manager starting on :%s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("Shutdown signal received, stopping server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}
	_ = redisClient.Close()
	log.Println("Server stopped gracefully")
}

func parseSFUNodes(env string) []*SFUNode {
	parts := strings.Split(env, ",")
	nodes := make([]*SFUNode, 0, len(parts))
	for i, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		// Extract ID from address (e.g., "livekit:7880" -> "livekit-0" or use index)
		id := p
		if !strings.Contains(p, "-") {
			// If no hyphen, use index-based ID
			id = "sfu-" + strconv.Itoa(i)
		}
		nodes = append(nodes, &SFUNode{
			ID:      id,
			Addr:    p,
			Load:    0.0,
			Healthy: true, // Start healthy, health poll will update
		})
	}
	if len(nodes) == 0 {
		log.Fatal("SFU_NODES must contain at least one node")
	}
	return nodes
}

func getNodeIDs(nodes []*SFUNode) []string {
	ids := make([]string, len(nodes))
	for i, n := range nodes {
		ids[i] = n.ID
	}
	return ids
}

func handleAssign(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	roomID := r.URL.Query().Get("roomId")
	if roomID == "" {
		http.Error(w, "roomId query parameter required", http.StatusBadRequest)
		return
	}

	// Check Redis cache first
	cacheKey := "sfu:assign:" + roomID
	ctx := r.Context()
	cached, err := redisClient.Get(ctx, cacheKey).Result()
	if err == nil && cached != "" {
		// Verify cached node is still healthy
		sfuNodesMu.RLock()
		for _, n := range sfuNodes {
			if n.ID == cached && n.isHealthy() {
				sfuNodesMu.RUnlock()
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(assignResponse{NodeID: n.ID, Addr: n.Addr, Load: n.getLoad()})
				return
			}
		}
		sfuNodesMu.RUnlock()
		// Cached node unhealthy, fall through to re-hash
	}

	// Compute HRW assignment
	node, ok := assignSFU(roomID)
	if !ok {
		http.Error(w, "No healthy SFU nodes available", http.StatusServiceUnavailable)
		return
	}

	// Cache assignment for 5 minutes (300s)
	_ = redisClient.Set(ctx, cacheKey, node.ID, 300*time.Second).Err()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(assignResponse{NodeID: node.ID, Addr: node.Addr, Load: node.getLoad()})
}

func assignSFU(roomID string) (*SFUNode, bool) {
	sfuNodesMu.RLock()
	defer sfuNodesMu.RUnlock()

	var best *SFUNode
	var bestScore uint64
	found := false

	for _, n := range sfuNodes {
		if !n.Healthy {
			continue
		}
		// HRW: h = xxhash(roomId|nodeID|salt) / weight
		// weight = 1 + load*10 (load 0.7 -> divisor 8)
		h := xxhash.Sum64String(roomID + "|" + n.ID + "|" + salt)
		divisor := uint64(1 + n.Load*10)
		if divisor == 0 {
			divisor = 1
		}
		score := h / divisor
		if !found || score > bestScore {
			best, bestScore, found = n, score, true
		}
	}
	return best, found
}

func healthPollLoop(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollHealth(ctx)
		}
	}
}

func pollHealth(ctx context.Context) {
	sfuNodesMu.RLock()
	nodes := make([]*SFUNode, len(sfuNodes))
	copy(nodes, sfuNodes)
	sfuNodesMu.RUnlock()

	for _, n := range nodes {
		healthy := checkSFUHealth(n.Addr)
		wasHealthy := n.isHealthy()
		n.setHealthy(healthy)

		if wasHealthy && !healthy {
			log.Printf("SFU %s (%s) became unhealthy", n.ID, n.Addr)
			// Invalidate Redis cache for rooms assigned to this node
			invalidateAssignmentsForNode(ctx, n.ID)
		} else if !wasHealthy && healthy {
			log.Printf("SFU %s (%s) recovered", n.ID, n.Addr)
		}
	}
}

func checkSFUHealth(addr string) bool {
	// LiveKit health endpoint is on port 9600
	healthURL := "http://" + addr + "/healthz"
	// addr is like "livekit:7880", but health is on 9600
	// Replace port with 9600
	host := addr
	if strings.Contains(addr, ":") {
		host = strings.Split(addr, ":")[0]
	}
	healthURL = "http://" + host + ":9600/healthz"

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(healthURL)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func invalidateAssignmentsForNode(ctx context.Context, nodeID string) {
	// Scan for keys matching sfu:assign:* and check if they map to this node
	// For P0, we use SCAN with pattern (acceptable for ≤50 rooms)
	iter := redisClient.Scan(ctx, 0, "sfu:assign:*", 100).Iterator()
	for iter.Next(ctx) {
		key := iter.Val()
		val, err := redisClient.Get(ctx, key).Result()
		if err == nil && val == nodeID {
			redisClient.Del(ctx, key)
		}
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}