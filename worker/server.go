package main

import (
	"encoding/json"
	"net/http"
)

type runRequest struct {
	Task   string         `json:"task"`
	Params map[string]any `json:"params"`
}

// Handler returns the worker's HTTP routes.
func (w *Worker) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(rw http.ResponseWriter, _ *http.Request) {
		rw.WriteHeader(http.StatusOK)
		_, _ = rw.Write([]byte("ok"))
	})
	mux.HandleFunc("POST /run", func(rw http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(rw, r.Body, 64<<10)
		var req runRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(rw, http.StatusBadRequest, Result{Error: "bad json: " + err.Error()})
			return
		}
		nums := map[string]float64{}
		kind := ""
		for k, v := range req.Params {
			switch t := v.(type) {
			case float64:
				nums[k] = t
			case string:
				if k == "kind" {
					kind = t
				}
			}
		}
		res := w.Run(r.Context(), req.Task, nums, kind)
		status := http.StatusOK
		if !res.OK {
			status = http.StatusUnprocessableEntity
		}
		writeJSON(rw, status, res)
	})
	return mux
}

func writeJSON(rw http.ResponseWriter, status int, v any) {
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(status)
	_ = json.NewEncoder(rw).Encode(v)
}
