# LeetCode source staging

Ledger: [#236](https://github.com/ethan-ngai/quorem/issues/236).

`python3 scripts/stage-leetcode.py /tmp/quorem-leetcode-stage` downloads pinned GitHub commit archives and writes `questions.json` and `report.json` to a new directory. The report records repository URLs, exact commits, counts, invalid or duplicate question identities, and unmatched company rows. Re-running with another output directory produces the same files for the same source archives. To update snapshots, change the commit pins after reviewing upstream changes and compare reports.

Each staged question retains the original source record, numeric public `frontend_id` as `leetcode_id`, and exact company directory names. Company `5. All.csv` rows join only by the LeetCode URL slug; duplicate associations collapse. Unmatched rows include questions absent from the free-question snapshot and must not be silently assigned by title. Company names are not merged by guesswork. Company associations are historical dataset tags, not verified interview claims. The source snapshots have different dates, so missing matches are expected.

This is **not** a Quorem question import or a database migration. It performs no database writes and cannot publish questions. The input lacks private tests and reference solutions, and source extraction can lose statement formatting or mistake SQL schemas for examples. Validate content, fixtures, execution and rights before any subsequent import or publication. Neither source repository declares a license; copied source records may be subject to LeetCode's rights. Keep staging files outside the repository and do not redistribute them without authorization. Existing [question JSON import](question-import.md) requires a different, validated format.
