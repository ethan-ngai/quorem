import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("stage_leetcode", Path(__file__).with_name("stage-leetcode.py"))
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class StageLeetcodeTest(unittest.TestCase):
    def test_join_deduplicate_and_report_unmatched(self):
        questions = [
            {"frontend_id": "1", "problem_slug": "two-sum", "title": "Two Sum"},
            {"frontend_id": "2", "problem_slug": "other"},
        ]
        files = [("Example", "Example/5. All.csv", "Title,Link\nTwo Sum,https://leetcode.com/problems/two-sum/\nTwo Sum,https://leetcode.com/problems/two-sum\nMissing,https://leetcode.com/problems/missing\nBad,https://evil.example/problems/other\n")]
        records, issues = source.stage(questions, files)
        self.assertEqual(records[0]["leetcode_id"], 1)
        self.assertEqual(records[0]["companies"], ["Example"])
        self.assertEqual(records[1]["companies"], [])
        self.assertEqual([issue["kind"] for issue in issues], ["unmatched_company_row"] * 2)

    def test_conflicting_identifiers_and_bad_csv_are_reported(self):
        questions = [
            {"frontend_id": "7", "problem_slug": "first"},
            {"frontend_id": "7", "problem_slug": "second"},
            {"frontend_id": "8", "problem_slug": "same"},
            {"frontend_id": "9", "problem_slug": "same"},
            {"frontend_id": "non-numeric", "problem_slug": "bad"},
        ]
        records, issues = source.stage(questions, [("Company", "bad.csv", "Title\nExample\n")])
        self.assertEqual(records, [])
        self.assertEqual([issue["kind"] for issue in issues], ["invalid_or_duplicate_question"] * 5 + ["invalid_csv"])

    def test_slug_requires_leetcode_problem_url(self):
        self.assertEqual(source.problem_slug("https://leetcode.com/problems/two-sum/?x=1"), "two-sum")
        self.assertIsNone(source.problem_slug("https://leetcode.com.evil.test/problems/two-sum"))
        self.assertIsNone(source.problem_slug("https://leetcode.com/problems/two-sum/solutions"))

    def test_company_evidence_preserves_overlapping_windows_and_unknown_ids(self):
        records = [{"source": {"problem_slug": "known"}, "leetcode_id": 7}]
        header = "Title,Link,Frequency\n"
        known = "Known,https://leetcode.com/problems/known,25.5\n"
        unknown = "Unknown,https://leetcode.com/problems/unknown,50\n"
        invalid = "Invalid,https://leetcode.com/problems/invalid,nan\n"
        rows, issues = source.stage_company_evidence(records, [
            ("Google", "Google/1. Thirty Days.csv", header + known + unknown + invalid + known),
            ("Google", "Google/2. Three Months.csv", header + known),
        ])
        self.assertEqual(
            [(row["window"], row["leetcodeId"], row["frequency"]) for row in rows],
            [("30d", 7, 25.5), ("30d", None, 50), ("3m", 7, 25.5)],
        )
        self.assertEqual([issue["kind"] for issue in issues], ["invalid_evidence_row", "duplicate_evidence_row"])


if __name__ == "__main__":
    unittest.main()
