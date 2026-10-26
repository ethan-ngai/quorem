package postgres

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/application"
)

type archivedMigration struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	SQL    []byte `json:"-"`
}

type migrationArchive struct {
	Baseline   string              `json:"baseline"`
	Migrations []archivedMigration `json:"migrations"`
}

// Validate the complete immutable archive before adopting any legacy ledger.
func loadMigrationArchive(dir string) (migrationArchive, error) {
	var archive migrationArchive
	root := filepath.Join(dir, "legacy")
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return archive, err
	}
	if err = json.Unmarshal(data, &archive); err != nil {
		return archive, err
	}
	if archive.Baseline == "" || filepath.Base(archive.Baseline) != archive.Baseline || !strings.HasSuffix(archive.Baseline, ".sql") || len(archive.Migrations) == 0 {
		return archive, fmt.Errorf("invalid migration archive manifest")
	}
	files, err := filepath.Glob(filepath.Join(root, "*.sql"))
	if err != nil || len(files) != len(archive.Migrations) {
		return archive, fmt.Errorf("incomplete migration archive")
	}
	sort.Strings(files)
	for i := range archive.Migrations {
		entry := &archive.Migrations[i]
		if entry.Name != filepath.Base(files[i]) {
			return archive, fmt.Errorf("invalid migration archive order")
		}
		entry.SQL, err = os.ReadFile(files[i])
		if err != nil {
			return archive, err
		}
		if application.Hash(entry.SQL) != entry.SHA256 {
			return archive, fmt.Errorf("migration archive checksum mismatch: %s", entry.Name)
		}
	}
	return archive, nil
}
