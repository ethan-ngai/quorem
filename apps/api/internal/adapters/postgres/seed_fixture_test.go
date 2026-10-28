package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestQuestionFixtureSeedReplayPreservesLanguageArtifacts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	fixtures, err := problems.LoadFixtures("../../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.SealProblemVersions(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.SeedProblems(ctx, fixtures); err != nil {
		t.Fatal("sealed seed replay", err)
	}
	for _, fixture := range fixtures {
		for _, impl := range fixture.Implementations {
			var starter, runtime, harness, reference string
			err = s.Pool.QueryRow(ctx, `SELECT starter_source,runtime_revision,harness_revision,reference_source FROM problem_languages WHERE version_id=$1 AND language=$2`, fixture.Problem.ID, impl.Language).Scan(&starter, &runtime, &harness, &reference)
			if err != nil || starter != impl.StarterSource || runtime != impl.RuntimeRevision || harness != impl.HarnessRevision || reference != impl.ReferenceSource {
				t.Fatalf("%s/%s: artifact mismatch: %v", fixture.Problem.Slug, impl.Language, err)
			}
		}
	}
}
