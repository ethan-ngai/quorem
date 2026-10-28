package problems

import (
	"encoding/json"
	"testing"
)

func BenchmarkCaseConstraints(b *testing.B) {
	values := make([]int, 10000)
	for i := range values {
		values[i] = i + 1
	}
	data, err := json.Marshal(values)
	if err != nil {
		b.Fatal(err)
	}
	min := float64(0)
	p := Problem{
		Signature: Signature{Parameters: []Parameter{{Name: "values", Type: "list<int>"}}, ReturnType: "int"},
		Constraints: []Constraint{
			{Kind: "range", Target: &ConstraintTarget{Parameter: "values", Projection: "elements"}, Min: &min},
			{Kind: "property", Target: &ConstraintTarget{Parameter: "values", Projection: "elements"}, Property: "unique"},
			{Kind: "comparison", Left: &ConstraintTarget{Parameter: "values", Projection: "length"}, Right: &ConstraintTarget{Parameter: "values", Projection: "sum"}, Operator: "le"},
		},
	}
	c := Case{Args: []json.RawMessage{data}}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := ValidateProblemCase(p, c, false); err != nil {
			b.Fatal(err)
		}
	}
}
