package workerpool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// engine is a minimal Docker Engine API client over the local unix socket.
// Only the handful of calls the pool needs; see docs/DEVIATIONS.md (prompt 04).
type engine struct {
	hc   *http.Client // short timeout, for request/response calls
	long *http.Client // no timeout, for the events stream
}

func newEngine(host string) (*engine, error) {
	if host == "" {
		host = os.Getenv("DOCKER_HOST")
	}
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	u, err := url.Parse(host)
	if err != nil || u.Scheme != "unix" {
		return nil, fmt.Errorf("workerpool: only unix:// docker hosts are supported, got %q", host)
	}
	sock := u.Path
	tr := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		},
	}
	return &engine{
		hc:   &http.Client{Transport: tr, Timeout: 60 * time.Second},
		long: &http.Client{Transport: tr},
	}, nil
}

// apiError is a non-2xx answer from the daemon.
type apiError struct {
	Status int
	Msg    string
}

func (e *apiError) Error() string { return fmt.Sprintf("docker api %d: %s", e.Status, e.Msg) }

func (e *engine) do(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, "http://docker"+path, body)
	if err != nil {
		return err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := e.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		var m struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &m)
		if m.Message == "" {
			m.Message = strings.TrimSpace(string(data))
		}
		return &apiError{Status: resp.StatusCode, Msg: m.Message}
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func isStatus(err error, code int) bool {
	ae, ok := err.(*apiError)
	return ok && ae.Status == code
}

// --- wire types (only the fields we use) ---

type resources struct {
	NanoCpus   int64 `json:"NanoCpus,omitempty"`
	CpuPeriod  int64 `json:"CpuPeriod,omitempty"`
	CpuQuota   int64 `json:"CpuQuota,omitempty"`
	Memory     int64 `json:"Memory,omitempty"`
	MemorySwap int64 `json:"MemorySwap,omitempty"`
	PidsLimit  int64 `json:"PidsLimit,omitempty"`
}

type hostConfig struct {
	resources
	NetworkMode    string   `json:"NetworkMode"`
	ReadonlyRootfs bool     `json:"ReadonlyRootfs"`
	CapDrop        []string `json:"CapDrop"`
	SecurityOpt    []string `json:"SecurityOpt"`
	Privileged     bool     `json:"Privileged"`
}

type createBody struct {
	Image      string            `json:"Image"`
	Env        []string          `json:"Env,omitempty"`
	Labels     map[string]string `json:"Labels,omitempty"`
	HostConfig hostConfig        `json:"HostConfig"`
}

type inspectResp struct {
	ID    string `json:"Id"`
	State struct {
		Running   bool   `json:"Running"`
		OOMKilled bool   `json:"OOMKilled"`
		ExitCode  int    `json:"ExitCode"`
		Status    string `json:"Status"`
	} `json:"State"`
	NetworkSettings struct {
		Networks map[string]struct {
			IPAddress string `json:"IPAddress"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
}

type dockerEvent struct {
	Action string `json:"Action"`
	Actor  struct {
		ID         string            `json:"ID"`
		Attributes map[string]string `json:"Attributes"`
	} `json:"Actor"`
	Time int64 `json:"time"`
}
