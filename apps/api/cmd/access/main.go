// Command access grants product privileges using separate operator database credentials.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"log"
	"os"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: access inspect|grant|revoke --user ID [--scope admin|internal|matches.host_guests|interviews.host|problems.odyssey --actor OPERATOR --reason TEXT --op-id ID --ref REF --dry-run]")
	}
	command := os.Args[1]
	flags := flag.NewFlagSet(command, flag.ExitOnError)
	g := access.Grant{}
	flags.StringVar(&g.UserID, "user", "", "Immutable product user ID")
	flags.StringVar(&g.Scope, "scope", "", "Access scope")
	flags.StringVar(&g.Actor, "actor", "", "Operator identity")
	flags.StringVar(&g.Reason, "reason", "", "Grant reason")
	flags.StringVar(&g.OperationID, "op-id", "", "Unique operation ID")
	flags.StringVar(&g.Source, "source", "manual", "Grant source")
	flags.StringVar(&g.Reference, "ref", "", "Source reference")
	resource := flags.String("resource", "", "Quota resource")
	value := flags.Int("value", 0, "Bounded quota value")
	dry := flags.Bool("dry-run", false, "Validate and roll back")
	expires := flags.String("expires", "", "Optional RFC3339 grant expiry")
	flags.Parse(os.Args[2:])
	if *expires != "" {
		at, e := time.Parse(time.RFC3339, *expires)
		if e != nil {
			log.Fatal("Invalid expiry")
		}
		g.ExpiresAt = &at
	}
	dsn := os.Getenv("QUOREM_OPERATOR_DATABASE_URL")
	if dsn == "" {
		log.Fatal("QUOREM_OPERATOR_DATABASE_URL is required; do not use web credentials")
	}
	s, err := postgres.Open(context.Background(), dsn)
	if err != nil {
		log.Fatal("Operator database unavailable")
	}
	defer s.Pool.Close()
	if command == "grant" || command == "revoke" {
		g.Revoke = command == "revoke"
		if err = s.ApplyGrant(context.Background(), g, *dry); err != nil {
			log.Fatal(err)
		}
	} else if command == "quota" {
		if err = s.ApplyQuota(context.Background(), g.UserID, *resource, g.Actor, g.Reason, g.OperationID, *value, *dry); err != nil {
			log.Fatal(err)
		}
	} else if command != "inspect" {
		log.Fatal("Unknown operation")
	}
	var role, kind string
	var bindings []byte
	if err = s.Pool.QueryRow(context.Background(), `SELECT role,kind,COALESCE((SELECT json_agg(json_build_object('issuer',issuer,'subject',subject)) FROM identity_bindings WHERE user_id=u.id),'[]'::json) FROM users u WHERE id=$1`, g.UserID).Scan(&role, &kind, &bindings); err != nil {
		log.Fatal("User not found")
	}
	c, err := s.Capabilities(context.Background(), g.UserID)
	if err != nil {
		log.Fatal(err)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"userId": g.UserID, "role": role, "kind": kind, "bindings": json.RawMessage(bindings), "capabilities": c, "dryRun": *dry})
}
