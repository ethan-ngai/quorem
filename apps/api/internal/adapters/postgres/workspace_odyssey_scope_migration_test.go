package postgres

import (
	"context"
	"os"
	"testing"
)

func TestWorkspaceOdysseyScopeMigrationPreservesProgressKeys(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	migration, err := os.ReadFile("../../../migrations/041_workspace_odyssey_scope.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, scope string
		allowed     bool
	}{
		{"null", "NULL", true},
		{"workspace", "id", true},
		{"different", "gen_random_uuid()", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := s.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err = tx.Exec(ctx, `CREATE TEMP TABLE workspaces(id uuid PRIMARY KEY, odyssey_scope uuid) ON COMMIT DROP`); err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, `INSERT INTO workspaces(id) VALUES(gen_random_uuid())`); err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, `UPDATE workspaces SET odyssey_scope=`+tc.scope); err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(ctx, string(migration))
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v: %v", tc.allowed, err)
			}
			if tc.allowed {
				var exists bool
				if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='pg_temp.workspaces'::regclass AND attname='odyssey_scope' AND NOT attisdropped)`).Scan(&exists); err != nil || exists {
					t.Fatalf("scope column retained: %v %v", exists, err)
				}
			}
		})
	}
}
