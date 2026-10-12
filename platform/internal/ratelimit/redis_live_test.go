package ratelimit

import (
	"fmt"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// Runs only when a real Redis is reachable (REDIS_URL or localhost:6379); skips otherwise.
func TestRedisLive(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skip("no redis:", err)
	}
	key := fmt.Sprintf("live-%d", time.Now().UnixNano())
	p := Params{Rate: 1, Burst: 3}
	// two replicas sharing one Redis must together admit only the burst
	a := NewRedis(rdb, time.Now, nil)
	b := NewRedis(rdb, time.Now, nil)
	got := 0
	for i := 0; i < 10; i++ {
		l := a
		if i%2 == 1 {
			l = b
		}
		if l.Take(ctx, key, 1, p).Allowed {
			got++
		}
	}
	if got != 3 || a.Degraded() || b.Degraded() {
		t.Fatalf("admitted %d (want 3), degraded a=%v b=%v", got, a.Degraded(), b.Degraded())
	}
	rdb.Del(ctx, "bk:tb:"+key)
}
