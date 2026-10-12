// Command worker is the per-tenant task executor. One instance runs in each
// tenant container; the platform dispatcher calls POST /run.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", envOr("WORKER_ADDR", ":8080"), "listen address")
	health := flag.Bool("healthcheck", false, "probe /healthz on localhost and exit 0/1 (for HEALTHCHECK; the image has no shell)")
	flag.Parse()

	if *health {
		os.Exit(probe(*addr))
	}

	w := &Worker{
		TenantID: os.Getenv("TENANT_ID"),
		DBProxy:  os.Getenv("DB_PROXY_URL"),
		Secret:   os.Getenv("DB_PROXY_SECRET"),
		HTTP:     &http.Client{Timeout: 30 * time.Second},
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           w.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	log.Printf("worker tenant=%q listening on %s", w.TenantID, *addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func probe(addr string) int {
	host := addr
	if len(host) > 0 && host[0] == ':' {
		host = "127.0.0.1" + host
	}
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get("http://" + host + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
