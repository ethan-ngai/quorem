package postgres

import "context"

// Seal after bootstrap registers all language artifacts and authored editorials.
// Admin publication seals its new version inside the publication transaction instead.
func (s *Store) SealProblemVersions(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, "UPDATE problem_versions SET sealed=true WHERE NOT sealed")
	return err
}
