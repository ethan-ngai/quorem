package postgres

import "github.com/ethan-ngai/quorem/apps/api/internal/problems"

func executionCases(f *problems.Fixture, level int, kind string, custom []problems.Case, publicFallback bool) ([]problems.Case, error) {
	cases := f.HiddenCases
	if f.Problem.Odyssey != nil {
		var err error
		f.Problem, cases, err = problems.CompileOdyssey(*f, level, kind)
		if err != nil {
			return nil, err
		}
	} else if kind == "run" || publicFallback && len(cases) == 0 {
		cases = f.Problem.SampleCases()
	}
	if custom != nil {
		if kind != "run" {
			return nil, failure("invalid_input", 400, "Submit cannot choose cases")
		}
		if err := problems.ValidateProblemCustomCases(f.Problem, custom); err != nil {
			return nil, failure("invalid_input", 400, err.Error())
		}
		return custom, nil
	}
	if publicFallback && len(cases) == 0 {
		return nil, failure("invalid_input", 400, "No tests configured")
	}
	validator := problems.NewCaseValidator(f.Problem)
	for _, test := range cases {
		if err := validator.Validate(test, false); err != nil {
			return nil, failure("invalid_input", 400, err.Error())
		}
	}
	return cases, nil
}
