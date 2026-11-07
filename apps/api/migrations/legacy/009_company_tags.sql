ALTER TABLE problems ADD COLUMN leetcode_id integer CHECK (leetcode_id > 0);
CREATE UNIQUE INDEX problems_leetcode_id ON problems (leetcode_id) WHERE leetcode_id IS NOT NULL;

CREATE TABLE companies (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 80 AND position(',' in name) = 0)
);
CREATE UNIQUE INDEX companies_name_ci ON companies (lower(name));
CREATE TABLE problem_companies (
    problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY (problem_id, company_id)
);
CREATE INDEX problem_companies_company_id ON problem_companies (company_id, problem_id);
