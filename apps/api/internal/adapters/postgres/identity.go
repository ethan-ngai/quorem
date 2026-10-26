package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/jackc/pgx/v5"
)

// ResolveIdentity binds immutable provider subjects; email never links accounts.
func (s *Store) ResolveIdentity(ctx context.Context, c identity.Claims) (identity.Principal, error) {
	p, image, e := boundIdentity(ctx, s.Pool, c)
	if e == nil && image == c.Image {
		return p, nil
	}
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return p, e
	}
	// Only creation and profile projection need serialization, never unchanged reads.
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		return identity.Principal{}, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", c.Issuer+":"+c.Subject); e != nil {
		return identity.Principal{}, e
	}
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
	p, image, e = boundIdentity(ctx, tx, c)
	if e != nil {
		return p, e
	}
	if image != c.Image {
		if _, e = tx.Exec(ctx, "UPDATE users SET profile_image=$2 WHERE id=$1 AND profile_image IS DISTINCT FROM $2", p.UserID, c.Image); e != nil {
			return p, e
		}
	}
	return p, tx.Commit(ctx)
}

func boundIdentity(ctx context.Context, q querier, c identity.Claims) (identity.Principal, string, error) {
	var p identity.Principal
	var disabled bool
	var role, image string
	err := q.QueryRow(ctx, "SELECT u.id,u.display_name,u.role,u.disabled,u.profile_image FROM users u JOIN identity_bindings b ON b.user_id=u.id WHERE b.issuer=$1 AND b.subject=$2", c.Issuer, c.Subject).Scan(&p.UserID, &p.DisplayName, &role, &disabled, &image)
	if err != nil {
		return p, image, err
	}
	if disabled {
		return p, image, identity.ErrUnauthorized
	}
	p.Admin = role == "admin"
	p.EmailVerified = c.EmailVerified
	p.SessionID = c.SessionID
	return p, image, nil
}

func (s *Store) DevelopmentIdentity(ctx context.Context, user string) (identity.Principal, error) {
	p := identity.Principal{UserID: user, EmailVerified: true, SessionID: "development"}
	var role string
	var disabled bool
	err := s.Pool.QueryRow(ctx, "SELECT display_name,role,disabled FROM users WHERE id=$1", user).Scan(&p.DisplayName, &role, &disabled)
	if err != nil {
		return p, err
	}
	if disabled {
		return p, identity.ErrUnauthorized
	}
	p.Admin = role == "admin"
	return p, nil
}
