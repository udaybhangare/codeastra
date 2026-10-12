// Package auth implements API-key exchange, HS256 JWTs and token revocation.
// Time is always injected (Now) so expiry logic is testable.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

const (
	RoleTenant = "tenant"
	RoleAdmin  = "admin"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpired      = errors.New("token expired")
)

// Claims is the JWT payload. TenantID is the only source of tenant identity downstream.
type Claims struct {
	Sub      string `json:"sub,omitempty"`
	TenantID string `json:"tenant_id,omitempty"`
	Tier     string `json:"tier,omitempty"`
	Role     string `json:"role"`
	Iat      int64  `json:"iat"`
	Exp      int64  `json:"exp"`
	JTI      string `json:"jti"`
}

// Signer signs and verifies HS256 tokens with one secret. Tenant and admin tokens use
// two Signers with different secrets, so one can never validate as the other.
type Signer struct {
	secret []byte
	Now    func() time.Time
}

func NewSigner(secret string, now func() time.Time) *Signer {
	return &Signer{secret: []byte(secret), Now: now}
}

// The header is fixed; Verify requires an exact match, which rules out alg confusion.
var headerB64 = base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))

func (s *Signer) mac(signingInput string) []byte {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(signingInput))
	return m.Sum(nil)
}

// Sign fills Iat/Exp/JTI (when unset) and returns the compact token.
func (s *Signer) Sign(c Claims, ttl time.Duration) (string, Claims, error) {
	now := s.Now()
	c.Iat = now.Unix()
	c.Exp = now.Add(ttl).Unix()
	if c.JTI == "" {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			return "", c, err
		}
		c.JTI = hex.EncodeToString(b)
	}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", c, err
	}
	in := headerB64 + "." + base64.RawURLEncoding.EncodeToString(payload)
	return in + "." + base64.RawURLEncoding.EncodeToString(s.mac(in)), c, nil
}

// Verify checks signature and expiry.
func (s *Signer) Verify(token string) (Claims, error) {
	var c Claims
	i := strings.IndexByte(token, '.')
	j := strings.LastIndexByte(token, '.')
	if i <= 0 || j <= i || token[:i] != headerB64 {
		return c, ErrInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(token[j+1:])
	if err != nil || !hmac.Equal(sig, s.mac(token[:j])) {
		return c, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(token[i+1 : j])
	if err != nil || json.Unmarshal(payload, &c) != nil {
		return c, ErrInvalidToken
	}
	if s.Now().Unix() >= c.Exp {
		return c, ErrExpired
	}
	return c, nil
}
