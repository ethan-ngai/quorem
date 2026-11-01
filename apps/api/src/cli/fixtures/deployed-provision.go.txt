package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func main() {
	seed := flag.Bool("seed", false, "Install catalog and private question after operator bootstrap")
	private := flag.String("private-question", "", "Private QuestionContent JSON file")
	flag.Parse()
	ctx := context.Background()
	if os.Getenv("DATABASE_URL") == "" {
		log.Fatal("DATABASE_URL required")
	}
	store, err := postgres.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer store.Pool.Close()
	if err = store.Migrate(ctx, "apps/api/migrations"); err != nil {
		log.Fatal(err)
	}
	if !*seed {
		return
	}
	var actor string
	if err = store.Pool.QueryRow(ctx, `SELECT b.user_id FROM access_audit seed JOIN identity_bindings b ON b.user_id=seed.user_id AND b.subject=seed.scope JOIN quorem_auth."user" a ON a.id=b.subject JOIN users u ON u.id=b.user_id WHERE seed.operation_id='bootstrap:operator' AND b.issuer=$1 AND a."emailVerified" AND u.role='admin' AND NOT u.disabled`, os.Getenv("AUTH_ORIGIN")).Scan(&actor); err != nil {
		log.Fatal("Verified operator binding required")
	}
	ctx = identity.With(ctx, identity.Principal{UserID: actor, Admin: true, EmailVerified: true})
	fixtures, err := problems.LoadFixtures("fixtures/problems")
	if err != nil {
		log.Fatal(err)
	}
	if err = store.SeedProblems(ctx, fixtures); err != nil {
		log.Fatal(err)
	}
	if err = store.SeedEditorials(ctx, "fixtures/editorials"); err != nil {
		log.Fatal(err)
	}
	if err = store.SealProblemVersions(ctx); err != nil {
		log.Fatal(err)
	}
	for _, input := range []struct{ path, visibility string }{
		{"fixtures/odyssey/balance-ledger.json", "global"}, {*private, "private"},
	} {
		if input.path == "" {
			continue
		}
		data, err := os.ReadFile(input.path)
		if err != nil {
			log.Fatal(err)
		}
		var content problems.QuestionContent
		if err = json.Unmarshal(data, &content); err != nil {
			log.Fatal(err)
		}
		id, err := store.SeedQuestion(ctx, actor, input.visibility, content)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("Seeded %s question version %s", input.visibility, id)
	}
	log.Printf("Catalog ready: %d public fixtures", len(fixtures))
}
