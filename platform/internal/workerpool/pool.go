// Package workerpool manages one container per tenant: create from policy,
// health-wait, restart on exit/OOM, and live cgroup limit updates.
package workerpool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/bulkhead/platform/internal/metrics"
)

const (
	labelManaged = "bulkhead.managed"
	labelTenant  = "bulkhead.tenant"
	workerPort   = 8080
)

// Config for a Pool.
type Config struct {
	Image           string                       // worker image, default bulkhead/worker:dev
	DockerHost      string                       // unix:// socket, default $DOCKER_HOST or /var/run/docker.sock
	Prefix          string                       // name prefix, default "bulkhead"
	AttachContainer string                       // optional: connect this container (bulkheadd) to every tenant network
	Env             []string                     // extra env for workers, e.g. DB_PROXY_URL=...
	TenantEnv       func(tenant string) []string // optional per-tenant env, e.g. DB_PROXY_SECRET
	Isolation       bool                         // false = containers get no resource limits
	ReadyTimeout    time.Duration
	Log             *slog.Logger
}

type tenantState struct {
	spec     Spec
	id       string
	netID    string
	ip       string
	sawOOM   bool
	removing bool
	restarts int
}

// Pool owns tenant worker containers.
type Pool struct {
	cfg Config
	eng *engine
	log *slog.Logger

	mu        sync.Mutex
	tenants   map[string]*tenantState
	isolation bool

	events chan Event
}

// New creates a Pool; it does not touch Docker until Ensure/Start.
func New(cfg Config) (*Pool, error) {
	if cfg.Image == "" {
		cfg.Image = "bulkhead/worker:dev"
	}
	if cfg.Prefix == "" {
		cfg.Prefix = "bulkhead"
	}
	if cfg.ReadyTimeout == 0 {
		cfg.ReadyTimeout = 20 * time.Second
	}
	if cfg.Log == nil {
		cfg.Log = slog.Default()
	}
	eng, err := newEngine(cfg.DockerHost)
	if err != nil {
		return nil, err
	}
	return &Pool{
		cfg: cfg, eng: eng, log: cfg.Log,
		tenants:   map[string]*tenantState{},
		isolation: cfg.Isolation,
		events:    make(chan Event, 64),
	}, nil
}

// Events delivers OOM/exit/restart notifications (best effort; drops if full).
func (p *Pool) Events() <-chan Event { return p.events }

func (p *Pool) emit(e Event) {
	select {
	case p.events <- e:
	default:
		p.log.Warn("workerpool event dropped", "tenant", e.Tenant, "kind", e.Kind)
	}
}

func (p *Pool) containerName(t string) string { return p.cfg.Prefix + "-worker-" + t }
func (p *Pool) networkName(t string) string   { return p.cfg.Prefix + "-net-" + t }

// effective returns the limits that should be in force given the isolation mode.
func (p *Pool) effective(s Spec) Spec {
	if p.isolation {
		return s
	}
	return Spec{TenantID: s.TenantID}
}

// Ensure creates and starts the tenant's container (and network) if missing
// and waits until the worker answers /healthz. If already managed it just
// applies the spec live.
func (p *Pool) Ensure(ctx context.Context, s Spec) error {
	if err := s.validate(); err != nil {
		return err
	}
	p.mu.Lock()
	if st, ok := p.tenants[s.TenantID]; ok {
		st.spec = s
		eff := p.effective(s)
		id := st.id
		p.mu.Unlock()
		return p.applyUpdate(ctx, id, eff)
	}
	eff := p.effective(s)
	p.mu.Unlock()

	// Clean up leftovers from a previous run with the same name.
	_ = p.eng.do(ctx, http.MethodDelete, "/containers/"+p.containerName(s.TenantID)+"?force=true", nil, nil)
	_ = p.eng.do(ctx, http.MethodDelete, "/networks/"+p.networkName(s.TenantID), nil, nil)

	var net struct {
		ID string `json:"Id"`
	}
	err := p.eng.do(ctx, http.MethodPost, "/networks/create", map[string]any{
		"Name": p.networkName(s.TenantID), "Driver": "bridge", "Internal": true,
		"Labels": map[string]string{labelManaged: "true", labelTenant: s.TenantID},
	}, &net)
	if err != nil {
		return fmt.Errorf("create network: %w", err)
	}
	cleanupNet := func() {
		_ = p.eng.do(context.WithoutCancel(ctx), http.MethodDelete, "/networks/"+net.ID, nil, nil)
	}
	if p.cfg.AttachContainer != "" {
		if err := p.eng.do(ctx, http.MethodPost, "/networks/"+net.ID+"/connect",
			map[string]any{"Container": p.cfg.AttachContainer}, nil); err != nil {
			cleanupNet()
			return fmt.Errorf("attach %s to tenant network: %w", p.cfg.AttachContainer, err)
		}
	}

	env := append([]string{"TENANT_ID=" + s.TenantID}, p.cfg.Env...)
	if p.cfg.TenantEnv != nil {
		env = append(env, p.cfg.TenantEnv(s.TenantID)...)
	}
	var created struct {
		ID string `json:"Id"`
	}
	err = p.eng.do(ctx, http.MethodPost, "/containers/create?name="+url.QueryEscape(p.containerName(s.TenantID)), createBody{
		Image:  p.cfg.Image,
		Env:    env,
		Labels: map[string]string{labelManaged: "true", labelTenant: s.TenantID},
		HostConfig: hostConfig{
			resources:      createResources(eff),
			NetworkMode:    p.networkName(s.TenantID),
			ReadonlyRootfs: true,
			CapDrop:        []string{"ALL"},
			SecurityOpt:    []string{"no-new-privileges"},
			Privileged:     false,
		},
	}, &created)
	if err != nil {
		cleanupNet()
		return fmt.Errorf("create container: %w", err)
	}
	if err := p.eng.do(ctx, http.MethodPost, "/containers/"+created.ID+"/start", nil, nil); err != nil {
		_ = p.eng.do(context.WithoutCancel(ctx), http.MethodDelete, "/containers/"+created.ID+"?force=true", nil, nil)
		cleanupNet()
		return fmt.Errorf("start container: %w", err)
	}

	st := &tenantState{spec: s, id: created.ID, netID: net.ID}
	p.mu.Lock()
	p.tenants[s.TenantID] = st
	p.mu.Unlock()

	if err := p.refreshIP(ctx, s.TenantID); err != nil {
		return err
	}
	return p.waitReady(ctx, s.TenantID)
}

// Addr returns the base URL of the tenant's worker, e.g. http://172.20.0.2:8080.
func (p *Pool) Addr(tenant string) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	st, ok := p.tenants[tenant]
	if !ok || st.ip == "" {
		return "", false
	}
	return fmt.Sprintf("http://%s:%d", st.ip, workerPort), true
}

// ContainerID returns the Docker container id for a tenant.
func (p *Pool) ContainerID(tenant string) (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	st, ok := p.tenants[tenant]
	if !ok {
		return "", false
	}
	return st.id, true
}

// Update changes the tenant's CPU and memory limits live (no restart). A
// non-positive value means unlimited. The spec is remembered so a later
// SetIsolation(true) restores it. With isolation off the call only records.
func (p *Pool) Update(ctx context.Context, tenant string, cpus float64, memMB int64) error {
	p.mu.Lock()
	st, ok := p.tenants[tenant]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("workerpool: unknown tenant %q", tenant)
	}
	st.spec.CPUs, st.spec.MemoryMB = cpus, memMB
	eff, id, iso := p.effective(st.spec), st.id, p.isolation
	p.mu.Unlock()
	if !iso {
		return nil
	}
	return p.applyUpdate(ctx, id, eff)
}

// SetIsolation flips the A/B mode: off removes all limits from running
// containers, on re-applies each tenant's remembered spec.
func (p *Pool) SetIsolation(ctx context.Context, on bool) error {
	type job struct {
		id  string
		eff Spec
	}
	p.mu.Lock()
	p.isolation = on
	jobs := make([]job, 0, len(p.tenants))
	for _, st := range p.tenants {
		jobs = append(jobs, job{st.id, p.effective(st.spec)})
	}
	p.mu.Unlock()
	var errs []error
	for _, j := range jobs {
		if err := p.applyUpdate(ctx, j.id, j.eff); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (p *Pool) applyUpdate(ctx context.Context, id string, eff Spec) error {
	return p.eng.do(ctx, http.MethodPost, "/containers/"+id+"/update", updateResources(eff), nil)
}

// Remove stops and deletes one tenant's container and network.
func (p *Pool) Remove(ctx context.Context, tenant string) error {
	p.mu.Lock()
	st, ok := p.tenants[tenant]
	if ok {
		st.removing = true
		delete(p.tenants, tenant)
	}
	p.mu.Unlock()
	if !ok {
		return nil
	}
	err := p.eng.do(ctx, http.MethodDelete, "/containers/"+st.id+"?force=true", nil, nil)
	if err != nil && !isStatus(err, http.StatusNotFound) {
		return err
	}
	if err := p.eng.do(ctx, http.MethodDelete, "/networks/"+st.netID, nil, nil); err != nil && !isStatus(err, http.StatusNotFound) {
		return err
	}
	return nil
}

// Close removes every managed tenant container and network.
func (p *Pool) Close(ctx context.Context) error {
	p.mu.Lock()
	names := make([]string, 0, len(p.tenants))
	for t := range p.tenants {
		names = append(names, t)
	}
	p.mu.Unlock()
	var errs []error
	for _, t := range names {
		errs = append(errs, p.Remove(ctx, t))
	}
	return errors.Join(errs...)
}

func (p *Pool) refreshIP(ctx context.Context, tenant string) error {
	p.mu.Lock()
	st, ok := p.tenants[tenant]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("workerpool: unknown tenant %q", tenant)
	}
	id := st.id
	p.mu.Unlock()

	var ins inspectResp
	if err := p.eng.do(ctx, http.MethodGet, "/containers/"+id+"/json", nil, &ins); err != nil {
		return err
	}
	ip := ins.NetworkSettings.Networks[p.networkName(tenant)].IPAddress
	if ip == "" {
		return fmt.Errorf("workerpool: no ip for %s on %s", tenant, p.networkName(tenant))
	}
	p.mu.Lock()
	st.ip = ip
	p.mu.Unlock()
	return nil
}

// waitReady polls the worker's /healthz until it answers 200.
func (p *Pool) waitReady(ctx context.Context, tenant string) error {
	ctx, cancel := context.WithTimeout(ctx, p.cfg.ReadyTimeout)
	defer cancel()
	t := time.NewTicker(100 * time.Millisecond)
	defer t.Stop()
	for {
		if addr, ok := p.Addr(tenant); ok {
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, addr+"/healthz", nil)
			c := http.Client{Timeout: time.Second}
			if resp, err := c.Do(req); err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("workerpool: %s not ready: %w", tenant, ctx.Err())
		case <-t.C:
		}
	}
}

// Start begins watching Docker events in the background: container exits and
// OOM kills are reported on Events() and the container is restarted. The
// stream is opened before Start returns so no event after it is missed.
func (p *Pool) Start(ctx context.Context) error {
	body, err := p.openEvents(ctx, 0)
	if err != nil {
		return err
	}
	go p.watch(ctx, body)
	return nil
}

func (p *Pool) openEvents(ctx context.Context, since int64) (io.ReadCloser, error) {
	filters, _ := json.Marshal(map[string][]string{
		"type": {"container"}, "label": {labelManaged + "=true"},
		"event": {"die", "oom", "health_status"},
	})
	q := "/events?filters=" + url.QueryEscape(string(filters))
	if since > 0 {
		q += fmt.Sprintf("&since=%d", since)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+q, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.eng.long.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("docker events: status %d", resp.StatusCode)
	}
	return resp.Body, nil
}

func (p *Pool) watch(ctx context.Context, body io.ReadCloser) {
	var last int64
	for {
		dec := json.NewDecoder(body)
		for {
			var ev dockerEvent
			if err := dec.Decode(&ev); err != nil {
				break
			}
			last = ev.Time
			p.handle(ctx, ev)
		}
		body.Close()
		for {
			if ctx.Err() != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			b, err := p.openEvents(ctx, last)
			if err != nil {
				p.log.Warn("workerpool: events reconnect failed", "err", err)
				continue
			}
			body = b
			break
		}
	}
}

func (p *Pool) handle(ctx context.Context, ev dockerEvent) {
	tenant := ev.Actor.Attributes[labelTenant]
	p.mu.Lock()
	st, ok := p.tenants[tenant]
	if !ok || st.removing || st.id != ev.Actor.ID {
		p.mu.Unlock()
		return
	}
	id := st.id
	p.mu.Unlock()

	switch {
	case ev.Action == "oom":
		p.mu.Lock()
		st.sawOOM = true
		p.mu.Unlock()

	case ev.Action == "die":
		var ins inspectResp
		_ = p.eng.do(ctx, http.MethodGet, "/containers/"+id+"/json", nil, &ins)
		p.mu.Lock()
		kind := classify(st.sawOOM, ins.State.OOMKilled, ins.State.ExitCode)
		st.sawOOM = false
		st.restarts++
		p.mu.Unlock()
		p.log.Warn("tenant container died", "tenant", tenant, "kind", kind, "exit", ins.State.ExitCode)
		p.emit(Event{Tenant: tenant, Kind: kind, ExitCode: ins.State.ExitCode, Unix: ev.Time})
		p.restart(ctx, tenant, id, ev.Time)

	case ev.Action == "health_status: unhealthy":
		p.emit(Event{Tenant: tenant, Kind: EventUnhealthy, Unix: ev.Time})
		if err := p.eng.do(ctx, http.MethodPost, "/containers/"+id+"/restart?t=1", nil, nil); err != nil {
			p.log.Error("restart unhealthy failed", "tenant", tenant, "err", err)
			return
		}
		_ = p.refreshIP(ctx, tenant)
		p.emit(Event{Tenant: tenant, Kind: EventRestarted, Unix: ev.Time})
	}
}

func (p *Pool) restart(ctx context.Context, tenant, id string, at int64) {
	var err error
	for i := 0; i < 5; i++ {
		if err = p.eng.do(ctx, http.MethodPost, "/containers/"+id+"/start", nil, nil); err == nil {
			break
		}
		if isStatus(err, http.StatusNotFound) || ctx.Err() != nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	if err != nil {
		p.log.Error("restart failed", "tenant", tenant, "err", err)
		return
	}
	if err := p.refreshIP(ctx, tenant); err != nil {
		p.log.Error("refresh ip failed", "tenant", tenant, "err", err)
	}
	p.emit(Event{Tenant: tenant, Kind: EventRestarted, Unix: at})
}

// Restarts reports how many times the tenant's container was restarted after dying.
func (p *Pool) Restarts(tenant string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if st, ok := p.tenants[tenant]; ok {
		return st.restarts
	}
	return 0
}

// Stats takes one cumulative CPU/memory reading per running tenant container
// (Docker stats, one-shot). Failures for a single container are skipped.
func (p *Pool) Stats(ctx context.Context) (map[string]metrics.ContainerStat, error) {
	p.mu.Lock()
	ids := make(map[string]string, len(p.tenants))
	for t, st := range p.tenants {
		if st.id != "" {
			ids[t] = st.id
		}
	}
	p.mu.Unlock()

	out := make(map[string]metrics.ContainerStat, len(ids))
	for t, id := range ids {
		var s struct {
			CPU struct {
				Usage struct {
					Total uint64 `json:"total_usage"`
				} `json:"cpu_usage"`
			} `json:"cpu_stats"`
			Mem struct {
				Usage uint64            `json:"usage"`
				Stats map[string]uint64 `json:"stats"`
			} `json:"memory_stats"`
		}
		if err := p.eng.do(ctx, "GET", "/containers/"+id+"/stats?stream=false&one-shot=true", nil, &s); err != nil {
			continue
		}
		mem := s.Mem.Usage
		if f := s.Mem.Stats["inactive_file"]; f < mem { // cgroup v2 page cache
			mem -= f
		}
		out[t] = metrics.ContainerStat{CPUNanos: s.CPU.Usage.Total, MemBytes: mem}
	}
	return out, nil
}
