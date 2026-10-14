package postgres

import (
	"context"
	"testing"
)

func TestProblemCatalogFilteringAndPagination(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, invalid := range []ProblemFilter{{Page: 1, Limit: 0}, {Page: 1, Limit: 101}, {Page: 10001, Limit: 20}} {
		if _, err := s.ProblemCatalog(ctx, invalid); errorCode(err) != "invalid_input" {
			t.Fatal("unbounded catalog admission", err)
		}
	}
	f := ProblemFilter{Sort: "title", Order: "asc", Page: 1, Limit: 2}
	first, err := s.ProblemCatalog(ctx, f)
	if err != nil || len(first.Items) != 2 || first.Total < 3 || len(first.Topics) == 0 {
		t.Fatalf("first %+v %v", first, err)
	}
	f.Page = 2
	second, err := s.ProblemCatalog(ctx, f)
	if err != nil || second.Items[0].ID == first.Items[0].ID || second.Total != first.Total {
		t.Fatalf("page %+v %v", second, err)
	}
	f.Page = 1
	f.Limit = 100
	f.Query = first.Items[0].Slug
	f.Difficulty = first.Items[0].Difficulty
	f.Topic = first.Items[0].Tags[0]
	filtered, err := s.ProblemCatalog(ctx, f)
	if err != nil || filtered.Total != 1 || filtered.Items[0].ID != first.Items[0].ID || len(filtered.Topics) != len(first.Topics) {
		t.Fatalf("filter %+v %v", filtered, err)
	}
	for _, query := range []string{"%", "' OR true --", "no-such-question"} {
		f.Query = query
		empty, err := s.ProblemCatalog(ctx, f)
		if err != nil || empty.Total != 0 || len(empty.Items) != 0 {
			t.Fatalf("literal query %q: %+v %v", query, empty, err)
		}
	}
	f.Query = ""
	f.Difficulty = ""
	f.Topic = ""
	f.Sort = "difficulty"
	f.Order = "desc"
	sorted, err := s.ProblemCatalog(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	rank := map[string]int{"easy": 0, "medium": 1, "hard": 2}
	for i := 1; i < len(sorted.Items); i++ {
		if rank[sorted.Items[i-1].Difficulty] < rank[sorted.Items[i].Difficulty] {
			t.Fatal("difficulty rank")
		}
	}
	f.Page = 10000
	empty, err := s.ProblemCatalog(ctx, f)
	if err != nil || len(empty.Items) != 0 || empty.Total != first.Total {
		t.Fatalf("past final page %+v %v", empty, err)
	}
}
