package httpapi

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func parseProblemFilter(q url.Values) (postgres.ProblemFilter, error) {
	f := postgres.ProblemFilter{Query: strings.TrimSpace(q.Get("q")), Difficulty: q.Get("difficulty"), Topic: q.Get("topic"), Sort: q.Get("sort"), Order: q.Get("order"), Page: 1, Limit: 20}
	invalid := func() (postgres.ProblemFilter, error) {
		return f, &postgres.Error{Code: "invalid_input", Status: 400, Message: "Invalid question filters"}
	}
	for _, key := range []string{"q", "difficulty", "topic", "sort", "order", "page", "limit"} {
		if len(q[key]) > 1 {
			return invalid()
		}
	}
	if utf8.RuneCountInString(f.Query) > 120 || utf8.RuneCountInString(f.Topic) > 80 {
		return invalid()
	}
	if f.Difficulty != "" && f.Difficulty != "easy" && f.Difficulty != "medium" && f.Difficulty != "hard" {
		return invalid()
	}
	if f.Sort == "" {
		f.Sort = "title"
	}
	if f.Sort != "title" && f.Sort != "difficulty" {
		return invalid()
	}
	if f.Order == "" {
		f.Order = "asc"
	}
	if f.Order != "asc" && f.Order != "desc" {
		return invalid()
	}
	for key, target := range map[string]*int{"page": &f.Page, "limit": &f.Limit} {
		if q.Has(key) {
			value, err := strconv.Atoi(q.Get(key))
			if err != nil || value < 1 {
				return invalid()
			}
			*target = value
		}
	}
	if f.Page > 10000 || f.Limit > 100 {
		return invalid()
	}
	return f, nil
}
