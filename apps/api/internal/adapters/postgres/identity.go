package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

// ResolveIdentity binds immutable provider subjects; email never links accounts.
func (s *Store) ResolveIdentity(ctx context.Context, c identity.Claims) (identity.Principal, error) {
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return identity.Principal{}, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", c.Issuer+":"+c.Subject); e != nil {
		return identity.Principal{}, e
	}
	var p identity.Principal
	var exists bool
	if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM identity_bindings WHERE issuer=$1 AND subject=$2)", c.Issuer, c.Subject).Scan(&exists); e != nil {
		return p, e
	}
	if !exists {
		id := ID()
		if _, e = tx.Exec(ctx, "INSERT INTO users(id,participant_id,display_name) VALUES($1::text,$1::text::uuid,$2)", id, c.Name); e != nil {
			return p, e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)", c.Issuer, c.Subject, id); e != nil {
			return p, e
		}
	}
	var disabled bool
	var role string
	e = tx.QueryRow(ctx, "SELECT u.id,u.display_name,u.role,u.disabled FROM users u JOIN identity_bindings b ON b.user_id=u.id WHERE b.issuer=$1 AND b.subject=$2", c.Issuer, c.Subject).Scan(&p.UserID, &p.DisplayName, &role, &disabled)
	if e != nil {
		return p, e
	}
	if disabled {
		return p, identity.ErrUnauthorized
	}
	p.Admin = role == "admin"
	p.EmailVerified = c.EmailVerified
	p.SessionID = c.SessionID
	return p, tx.Commit(ctx)
}
