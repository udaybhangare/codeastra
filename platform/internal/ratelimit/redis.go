package ratelimit

import (
	"context"
	"log/slog"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Atomic refill+take. Time comes from Redis so replicas agree. Returns {allowed, retry_ms}.
var takeScript = redis.NewScript(`
local rate, burst, n = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens, ts = tonumber(d[1]), tonumber(d[2])
if tokens == nil then tokens = burst; ts = now end
tokens = math.min(burst, tokens + math.max(0, now - ts) / 1000 * rate)
local allowed, retry = 0, 0
if tokens >= n then tokens = tokens - n; allowed = 1
else retry = math.ceil((n - tokens) / rate * 1000) end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(burst / rate * 1000) + 1000)
return {allowed, retry}`)

var refundScript = redis.NewScript(`
local burst, n = tonumber(ARGV[1]), tonumber(ARGV[2])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens'))
if tokens == nil then return 0 end
redis.call('HSET', KEYS[1], 'tokens', math.min(burst, tokens + n))
return 1`)

// RedisTimeout bounds every Redis round trip (docs: never block the hot path on Redis).
const RedisTimeout = 5 * time.Millisecond

// Redis is a Limiter backed by Redis Lua. A local Memory bucket with the same params is a
// fast pre-check (a local deny never costs a round trip). Any Redis error or timeout falls
// back to the local bucket result and flips Degraded.
type Redis struct {
	rdb      redis.Scripter
	local    *Memory
	log      *slog.Logger
	degraded atomic.Bool
}

func NewRedis(rdb redis.Scripter, now Clock, log *slog.Logger) *Redis {
	if log == nil {
		log = slog.Default()
	}
	return &Redis{rdb: rdb, local: NewMemory(now), log: log}
}

// Degraded reports whether the last Redis call failed (local-only mode).
func (r *Redis) Degraded() bool { return r.degraded.Load() }

func (r *Redis) Take(ctx context.Context, key string, n float64, p Params) Result {
	res := r.local.Take(ctx, key, n, p)
	if !res.Allowed {
		return res
	}
	cctx, cancel := context.WithTimeout(ctx, RedisTimeout)
	defer cancel()
	out, err := takeScript.Run(cctx, r.rdb, []string{"bk:tb:" + key}, p.Rate, p.Burst, n).Int64Slice()
	if err != nil || len(out) != 2 {
		r.setDegraded(err)
		return res // local decision stands
	}
	r.setDegraded(nil)
	if out[0] == 1 {
		return Result{Allowed: true}
	}
	r.local.Refund(ctx, key, n, p)
	return Result{RetryAfter: time.Duration(out[1]) * time.Millisecond}
}

func (r *Redis) Refund(ctx context.Context, key string, n float64, p Params) {
	r.local.Refund(ctx, key, n, p)
	cctx, cancel := context.WithTimeout(ctx, RedisTimeout)
	defer cancel()
	_, err := refundScript.Run(cctx, r.rdb, []string{"bk:tb:" + key}, strconv.FormatFloat(p.Burst, 'f', -1, 64), n).Result()
	if err != nil {
		r.setDegraded(err)
	}
}

func (r *Redis) setDegraded(err error) {
	if err == nil {
		if r.degraded.Swap(false) {
			r.log.Info("ratelimit: redis recovered")
		}
		return
	}
	if !r.degraded.Swap(true) { // log only on transition
		r.log.Warn("ratelimit: redis unavailable, degraded to local buckets", "err", err)
	}
}
