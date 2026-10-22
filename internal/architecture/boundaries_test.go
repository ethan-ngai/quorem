package architecture

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// Keep infrastructure imports out of application rules and HTTP policy as adapters grow.
func TestApplicationImportsStayProviderNeutral(t *testing.T) {
	_, here, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(here), "../.."))
	dirs := []string{"httpapi", "application", "matches", "problems", "judging", "workspace"}
	for _, dir := range dirs {
		path := filepath.Join(root, "apps/api/internal", dir)
		err := filepath.WalkDir(path, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, imp := range file.Imports {
				value, _ := strconv.Unquote(imp.Path.Value)
				for _, forbidden := range []string{"github.com/aws/", "github.com/cloudflare/", "github.com/jackc/", "/internal/adapters/"} {
					if strings.Contains(value, forbidden) {
						t.Errorf("%s imports infrastructure %s", path, value)
					}
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
}
