package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func call(t *testing.T, h http.Handler, body string) (int, Result) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/run", strings.NewReader(body)))
	var r Result
	_ = json.Unmarshal(rec.Body.Bytes(), &r)
	return rec.Code, r
}

func TestTasks(t *testing.T) {
	h := (&Worker{}).Handler()

	if c, r := call(t, h, `{"task":"echo"}`); c != 200 || !r.OK {
		t.Fatalf("echo: %d %+v", c, r)
	}

	c, r := call(t, h, `{"task":"cpu-burn","params":{"ms":50}}`)
	if c != 200 || r.CPUMS < 45 || r.CPUMS > 250 {
		t.Fatalf("cpu-burn cpu_ms out of range: %d %+v", c, r)
	}

	c, r = call(t, h, `{"task":"mem-alloc","params":{"mb":32,"hold_ms":5}}`)
	if c != 200 || r.MemPeakMB < 32 {
		t.Fatalf("mem-alloc peak too low: %d %+v", c, r)
	}

	c, r = call(t, h, `{"task":"io-heavy","params":{"kb":64}}`)
	if c != 200 || r.Bytes != 64*1024 {
		t.Fatalf("io-heavy: %d %+v", c, r)
	}

	if c, r = call(t, h, `{"task":"db-query","params":{"kind":"light"}}`); c != 422 || r.OK {
		t.Fatalf("db-query stub should fail cleanly: %d %+v", c, r)
	}
	if c, _ = call(t, h, `{"task":"nope"}`); c != 422 {
		t.Fatalf("unknown task: %d", c)
	}
	if c, _ = call(t, h, `{"task":"cpu-burn","params":{"ms":0}}`); c != 422 {
		t.Fatalf("invalid ms: %d", c)
	}
	if c, _ = call(t, h, `not json`); c != 400 {
		t.Fatalf("bad json: %d", c)
	}
}
