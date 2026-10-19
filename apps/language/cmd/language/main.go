package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/ethan-ngai/quorem/apps/language/internal/gateway"
)

func main() {
	address := os.Getenv("LANGUAGE_ADDR")
	if address == "" {
		address = "127.0.0.1:8081"
	}
	host, port, err := net.SplitHostPort(address)
	number, e := strconv.Atoi(port)
	if err != nil || e != nil || host != "127.0.0.1" || number < 1 || number > 65535 {
		log.Fatal("Language gateway requires a loopback IPv4 address")
	}
	dev := os.Getenv("QUOREM_DEV_IDENTITY") == "true"
	if dev && os.Getenv("NODE_ENV") == "production" {
		log.Fatal("Development identities forbidden in production")
	}
	capacity := 8
	if value := os.Getenv("LANGUAGE_MAX_SESSIONS"); value != "" {
		capacity, err = strconv.Atoi(value)
		if err != nil {
			log.Fatal("Invalid language capacity")
		}
	}
	idle := 5 * time.Minute
	if value := os.Getenv("LANGUAGE_IDLE_TIMEOUT"); value != "" {
		idle, err = time.ParseDuration(value)
		if err != nil {
			log.Fatal("Invalid idle timeout")
		}
	}
	service, err := gateway.New(gateway.Config{Address: address, WebOrigin: os.Getenv("WEB_ORIGIN"), AuthOrigin: os.Getenv("AUTH_ORIGIN"), IdentityURL: os.Getenv("API_IDENTITY_URL"), DevIdentity: dev, MaxSessions: capacity, IdleTimeout: idle})
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: address, Handler: service, ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 32 * 1024}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	shutdownResult := make(chan error, 1)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		err := service.Shutdown(ctx)
		_ = server.Shutdown(ctx)
		shutdownResult <- err
	}()
	log.Printf("Quorem Go language gateway: http://%s", address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	if err := <-shutdownResult; err != nil {
		log.Fatal("Language cleanup incomplete")
	}
}
