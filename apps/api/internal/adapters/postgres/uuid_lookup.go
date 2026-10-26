package postgres

import "github.com/jackc/pgx/v5/pgtype"

// Invalid public lookup IDs match no rows; cast the parameter, never the indexed column.
func uuidLookup(value string) pgtype.UUID {
	var id pgtype.UUID
	if len(value) != 36 || id.Scan(value) != nil {
		return pgtype.UUID{}
	}
	return id
}
