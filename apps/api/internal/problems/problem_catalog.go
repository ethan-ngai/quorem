package problems

type ProblemFilter struct {
	Query, Difficulty, Topic, Sort, Order, Library, Type string
	Page, Limit                                          int
}
type ProblemPage struct {
	Items  []Problem `json:"items"`
	Total  int       `json:"total"`
	Page   int       `json:"page"`
	Limit  int       `json:"limit"`
	Topics []string  `json:"topics"`
}
