package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

type memStore []KeyRecord

func (m memStore) ByPrefix(_ context.Context, p string) ([]KeyRecord, error) { return m, nil }

func TestJWTRoundTripAndExpiry(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	s := NewSigner("secret-secret-secret", c.now)
	tok, claims, err := s.Sign(Claims{TenantID: "a", Tier: "pro", Role: RoleTenant}, 15*time.Minute)
	if err != nil || claims.JTI == "" {
		t.Fatal(err, claims)
	}
	got, err := s.Verify(tok)
	if err != nil || got.TenantID != "a" || got.Tier != "pro" {
		t.Fatalf("verify: %v %+v", err, got)
	}
	c.t = c.t.Add(15 * time.Minute)
	if _, err := s.Verify(tok); !errors.Is(err, ErrExpired) {
		t.Fatalf("want expired, got %v", err)
	}
}

func TestJWTRejectsTamperAndWrongSecret(t *testing.T) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	s := NewSigner("secret-secret-secret", c.now)
	tok, _, _ := s.Sign(Claims{TenantID: "a", Role: RoleTenant}, time.Minute)
	if _, err := NewSigner("other-other-other-x", c.now).Verify(tok); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("wrong secret accepted")
	}
	for _, bad := range []string{"", "a.b", "a.b.c", tok + "x", tok[:len(tok)-2]} {
		if _, err := s.Verify(bad); err == nil {
			t.Fatalf("accepted %q", bad)
		}
	}
	// alg=none style token
	if _, err := s.Verify("eyJhbGciOiJub25lIn0.eyJ0ZW5hbnRfaWQiOiJhIn0."); err == nil {
		t.Fatal("alg none accepted")
	}
}

func TestExchange(t *testing.T) {
	key := "bk_0123456789abcdef"
	rec := KeyRecord{TenantID: "a", Tier: "pro", KeyHash: HashKey(key)}
	cases := []struct {
		name  string
		store memStore
		key   string
		ok    bool
	}{
		{"valid", memStore{rec}, key, true},
		{"unknown", memStore{}, key, false},
		{"wrong key same prefix", memStore{rec}, "bk_0123456789abcdeX", false},
		{"revoked", memStore{{TenantID: "a", KeyHash: rec.KeyHash, Revoked: true}}, key, false},
		{"suspended", memStore{{TenantID: "a", KeyHash: rec.KeyHash, Suspended: true}}, key, false},
		{"too short", memStore{rec}, "bk_", false},
		{"empty", memStore{rec}, "", false},
	}
	for _, tc := range cases {
		id, err := (&Authenticator{Store: tc.store}).Exchange(context.Background(), tc.key)
		if tc.ok && (err != nil || id.TenantID != "a") {
			t.Errorf("%s: %v %+v", tc.name, err, id)
		}
		if !tc.ok && !errors.Is(err, ErrBadKey) {
			t.Errorf("%s: want ErrBadKey, got %v", tc.name, err)
		}
	}
}

func TestRevocations(t *testing.T) {
	c := &clock{time.Unix(100, 0)}
	r := NewRevocations(c.now)
	if r.Revoked(Claims{JTI: "x", TenantID: "a", Iat: 100}) {
		t.Fatal("unexpected")
	}
	r.RevokeJTI("x", 1000)
	if !r.Revoked(Claims{JTI: "x", TenantID: "a", Iat: 100}) {
		t.Fatal("jti not revoked")
	}
	r.RevokeTenant("b")
	if !r.Revoked(Claims{JTI: "y", TenantID: "b", Iat: 90}) {
		t.Fatal("tenant cutoff not applied")
	}
	c.t = c.t.Add(time.Second)
	if r.Revoked(Claims{JTI: "y", TenantID: "b", Iat: 101}) {
		t.Fatal("token issued after cutoff rejected")
	}
}

func BenchmarkVerify(b *testing.B) {
	c := &clock{time.Unix(1_700_000_000, 0)}
	s := NewSigner("secret-secret-secret", c.now)
	tok, _, _ := s.Sign(Claims{TenantID: "acme-shop", Tier: "pro", Role: RoleTenant}, time.Hour)
	r := NewRevocations(c.now)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cl, err := s.Verify(tok)
		if err != nil || r.Revoked(cl) {
			b.Fatal(err)
		}
	}
}
