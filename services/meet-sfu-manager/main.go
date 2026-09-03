// meet-sfu-manager — W1 scaffold: barebones health endpoint.
// No business logic — only /healthz (port 8081).
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.SetOutput(os.Stdout)

	port := getEnv("PORT", "8081")

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(healthResponse{Status: "ok", Service: "meet-sfu-manager"})
	})
	// 404 for everything else
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
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