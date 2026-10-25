package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/jackc/pgx/v5"
)

func capabilities(ctx context.Context, tx pgx.Tx, owner string) (access.Capabilities, error) {
	c := access.Capabilities{GuestConcurrency: 2}
	var kind string
	var disabled bool
	if err := tx.QueryRow(ctx, "SELECT kind,disabled FROM users WHERE id=$1", owner).Scan(&kind, &disabled); err != nil {
		return c, err
	}
	if kind != "account" || disabled {
		return c, nil
	}

	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','matches.host_guests') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())),EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','intelligence.hosted') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp())),EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','experimental') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()))`, owner).Scan(&c.HostGuests, &c.HostedIntelligence, &c.Experimental)
	if err != nil {
		return c, err
	}
	rows, err := tx.Query(ctx, "SELECT resource,value FROM quota_overrides WHERE user_id=$1 AND (expires_at IS NULL OR expires_at>clock_timestamp())", owner)
	if err != nil {
		return c, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var value int
		if err := rows.Scan(&key, &value); err != nil {
			return c, err
		}
		switch key {
		case "guest_concurrency":
			c.GuestConcurrency = min(value, 8)
		}
	}
	return c, rows.Err()
}
func (s *Store) Capabilities(ctx context.Context, owner string) (access.Capabilities, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return access.Capabilities{}, err
	}
	defer tx.Rollback(ctx)
	c, err := capabilities(ctx, tx, owner)
	if err != nil {
		return c, err
	}
	return c, tx.Commit(ctx)
}

// ApplyGrant is operator-only; no HTTP route exposes privilege mutation.
func (s *Store) ApplyGrant(ctx context.Context, g access.Grant, dry bool) error {
	if g.OperationID == "" || g.UserID == "" || g.Actor == "" || g.Reason == "" || g.Reference == "" {
		return failure("invalid_input", 400, "Operation, target, actor, reason and reference are required")
	}
	if g.Scope != "admin" && g.Scope != "internal" && g.Scope != "matches.host_guests" && g.Scope != "intelligence.hosted" && g.Scope != "experimental" {
		return failure("invalid_input", 400, "Unknown access scope")
	}
	if g.Source != "manual" && g.Source != "internal" && g.Source != "subscription" {
		return failure("invalid_input", 400, "Invalid grant source")
	}
	if g.Scope == "admin" && g.ExpiresAt != nil {
		return failure("invalid_input", 400, "Administrator grants do not support expiry; revoke explicitly")
	}
	if g.Scope == "admin" && g.Source == "subscription" {
		return failure("forbidden", 403, "Subscriptions cannot grant administrator access")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var kind string
	if err = tx.QueryRow(ctx, "SELECT kind FROM users WHERE id=$1 FOR UPDATE", g.UserID).Scan(&kind); err != nil {
		return err
	}
	if kind != "account" {
		return failure("forbidden", 403, "Guests cannot receive account grants")
	}
	data, _ := json.Marshal(g)
	fingerprint := Hash(data)
	var scope string
	err = tx.QueryRow(ctx, "SELECT scope FROM access_audit WHERE operation_id=$1", g.OperationID).Scan(&scope)
	if err == nil {
		if scope != fingerprint {
			return failure("idempotency_conflict", 409, "Operation ID already used")
		}
		return nil
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if g.Scope == "admin" {
		role := "admin"
		if g.Revoke {
			role = "user"
		}
		_, err = tx.Exec(ctx, "UPDATE users SET role=$2 WHERE id=$1", g.UserID, role)
	} else if g.Revoke {
		_, err = tx.Exec(ctx, "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=$1 AND feature=$2 AND source=$3 AND source_ref=$4", g.UserID, g.Scope, g.Source, g.Reference)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,feature,source,source_ref) DO UPDATE SET revoked_at=NULL,actor=EXCLUDED.actor,reason=EXCLUDED.reason,expires_at=EXCLUDED.expires_at`, ID(), g.UserID, g.Scope, g.Source, g.Reference, g.Actor, g.Reason, g.ExpiresAt)
	}
	if err != nil {
		return err
	}
	action := "grant:" + g.Scope
	if g.Revoke {
		action = "revoke:" + g.Scope
	}
	if _, err = tx.Exec(ctx, "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$3,$4,$5,$6)", g.OperationID, g.Actor, g.UserID, action, fingerprint, g.Reason); err != nil {
		return err
	}
	if dry {
		return nil
	}
	return tx.Commit(ctx)
}
func requireGuestHosting(ctx context.Context, tx pgx.Tx, owner, mode string) error {
	var kind string
	if err := tx.QueryRow(ctx, "SELECT kind FROM users WHERE id=$1", owner).Scan(&kind); err != nil {
		return err
	}
	if kind != "account" {
		return failure("forbidden", 403, "An account is required to host")
	}
	if mode != "guests_allowed" {
		return nil
	}
	c, err := capabilities(ctx, tx, owner)
	if err != nil {
		return err
	}
	if !c.HostGuests {
		return failure("entitlement_required", 403, "Guest hosting requires an eligible plan")
	}
	return nil
}

// ApplyQuota keeps resource overrides bounded and audited, separate from feature grants.
func (s *Store) ApplyQuota(ctx context.Context, owner, resource, actor, reason, operation string, value int, dry bool) error {
	maxValue := 0
	switch resource {
	case "guest_concurrency":
		maxValue = 8
	}
	if value < 1 || value > maxValue || actor == "" || reason == "" || operation == "" {
		return failure("invalid_input", 400, "Invalid quota override")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 AND kind='account' FOR UPDATE", owner).Scan(&id); err != nil {
		return err
	}
	fingerprint := Hash([]byte(owner + ":" + resource + ":" + fmt.Sprint(value) + ":" + actor + ":" + reason))
	var prior string
	err = tx.QueryRow(ctx, "SELECT scope FROM access_audit WHERE operation_id=$1", operation).Scan(&prior)
	if err == nil {
		if prior == fingerprint {
			return nil
		}
		return failure("idempotency_conflict", 409, "Operation ID already used")
	}
	if err != pgx.ErrNoRows {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,resource) DO UPDATE SET value=EXCLUDED.value,actor=EXCLUDED.actor,reason=EXCLUDED.reason,expires_at=NULL", owner, resource, value, actor, reason); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$3,$4,$5,$6)", operation, actor, owner, "quota:"+resource, fingerprint, reason); err != nil {
		return err
	}
	if dry {
		return nil
	}
	return tx.Commit(ctx)
}
