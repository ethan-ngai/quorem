package httpapi

import (
	"net/url"
	"strings"
	"testing"
)

func TestProblemFilters(t *testing.T) {
	f, err := parseProblemFilter(url.Values{})
	if err != nil || f.Page != 1 || f.Limit != 20 || f.Sort != "title" || f.Order != "asc" {
		t.Fatalf("defaults: %+v %v", f, err)
	}
	f, err = parseProblemFilter(url.Values{"q": {" tree "}, "difficulty": {"medium"}, "topic": {"tree"}, "sort": {"difficulty"}, "order": {"desc"}, "page": {"2"}, "limit": {"100"}})
	if err != nil || f.Query != "tree" || f.Page != 2 || f.Limit != 100 {
		t.Fatalf("valid: %+v %v", f, err)
	}
	for _, raw := range []string{"limit=101", "limit=0", "page=10001", "page=-1", "page=1.5", "page=", "sort=title%3BDROP", "order=sideways", "difficulty=unknown", "q=a&q=b", "q=" + strings.Repeat("x", 121), "topic=" + strings.Repeat("x", 81)} {
		q, _ := url.ParseQuery(raw)
		if _, err := parseProblemFilter(q); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}
