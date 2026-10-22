package problems

import "time"

type QuestionDraft struct {
	ID                 string          `json:"id"`
	Revision           string          `json:"revision"`
	Content            QuestionContent `json:"content"`
	PublishedVersionID string          `json:"publishedVersionId,omitempty"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}
type QuestionDraftSummary struct {
	ID                 string    `json:"id"`
	Revision           string    `json:"revision"`
	Title              string    `json:"title"`
	Slug               string    `json:"slug"`
	PublishedVersionID string    `json:"publishedVersionId,omitempty"`
	UpdatedAt          time.Time `json:"updatedAt"`
}
type QuestionDraftPage struct {
	Items      []QuestionDraftSummary `json:"items"`
	NextCursor string                 `json:"nextCursor,omitempty"`
}
