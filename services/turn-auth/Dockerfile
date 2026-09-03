# turn-auth — multi-stage Dockerfile for Go 1.22 alpine
# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git ca-certificates

COPY go.mod ./
RUN go mod download

COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o turn-auth .

# Runtime stage
FROM alpine:3.20

RUN apk add --no-cache wget ca-certificates

WORKDIR /app

COPY --from=builder /app/turn-auth .

EXPOSE 8080

USER 1000:1000

ENTRYPOINT ["./turn-auth"]