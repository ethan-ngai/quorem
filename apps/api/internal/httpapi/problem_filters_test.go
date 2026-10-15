package httpapi

import (
	"net/url"
	"strings"
	"testing"
)

func TestProblemFilters(t *testing.T) {
	multi, multiErr := parseProblemFilter(url.Values{"difficulty": {"easy,medium"}, "topic": {"arrays,strings"}})
	if multiErr != nil || multi.Difficulty != "easy,medium" || multi.Topic != "arrays,strings" {
		t.Fatalf("multiple filters: %+v %v", multi, multiErr)
	}
	for _, value := range []string{"easy,unknown", "easy,", ",medium"} {
		if _, err := parseProblemFilter(url.Values{"difficulty": {value}}); err == nil {
			t.Fatalf("accepted invalid list %q", value)
		}
	}
	if _, err := parseProblemFilter(url.Values{"topic": {strings.Repeat("arrays,", 16) + "strings"}}); err == nil {
		t.Fatal("accepted too many topics")
	}
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
