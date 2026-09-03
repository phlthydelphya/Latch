# meet-signal — multi-stage Dockerfile for Go 1.22 alpine
# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go.mod and download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY main.go ./

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o meet-signal .

# Runtime stage
FROM alpine:3.20

# Install wget for healthcheck (compose uses: wget -qO- http://localhost:8080/healthz)
RUN apk add --no-cache wget ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/meet-signal .

# Expose ports: 8080 (healthz), 9091 (metrics)
EXPOSE 8080 9091

# Run as non-root
USER 1000:1000

ENTRYPOINT ["./meet-signal"]