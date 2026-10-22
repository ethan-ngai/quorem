package httpapi

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func parseProblemFilter(q url.Values) (problems.ProblemFilter, error) {
	f := problems.ProblemFilter{Query: strings.TrimSpace(q.Get("q")), Difficulty: q.Get("difficulty"), Topic: q.Get("topic"), Sort: q.Get("sort"), Order: q.Get("order"), Page: 1, Limit: 20}
	invalid := func() (problems.ProblemFilter, error) {
		return f, &application.Error{Code: "invalid_input", Status: 400, Message: "Invalid question filters"}
	}
	for _, key := range []string{"q", "difficulty", "topic", "sort", "order", "page", "limit"} {
		if len(q[key]) > 1 {
			return invalid()
		}
	}
	if utf8.RuneCountInString(f.Query) > 120 {
		return invalid()
	}
	for _, category := range []struct {
		value      string
		difficulty bool
	}{{f.Difficulty, true}, {f.Topic, false}} {
		if category.value == "" {
			continue
		}
		values := strings.Split(category.value, ",")
		if len(values) > 16 {
			return invalid()
		}
		for _, value := range values {
			if value == "" || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > 80 {
				return invalid()
			}
			if category.difficulty && value != "easy" && value != "medium" && value != "hard" {
				return invalid()
			}
		}
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
