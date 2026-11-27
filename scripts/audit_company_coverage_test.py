import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("audit_company_coverage", Path(__file__).with_name("audit-company-coverage.py"))
coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coverage)


class CompanyCoverageTest(unittest.TestCase):
    def test_recency_then_frequency_and_verified_identity(self):
        def row(slug, leetcode_id, window, frequency):
            return {
                "company": "Google", "title": slug, "leetcodeSlug": slug,
                "leetcodeId": leetcode_id, "window": window, "frequency": frequency,
            }

        evidence = {
            "windows": ["30d", "3m", "all"],
            "rows": [
                row("a", 1, "30d", 3),
                row("a", 1, "3m", 90),
                row("b", 2, "30d", 5),
                row("same-slug", None, "3m", 100),
                row("historical", 4, "all", 100),
            ],
        }
        catalog = [
            {"leetcodeId": 1, "slug": "renamed", "companies": ["GOOGLE"]},
            {"leetcodeId": 3, "slug": "same-slug", "companies": ["Google"]},
            {"leetcodeId": 4, "slug": "historical"},
            {"slug": "original"},
        ]
        result, = coverage.audit(evidence, catalog, ["Google"])
        questions = result["questions"]
        self.assertEqual([q["status"] for q in questions], ["missing", "published", "unresolved", "published"])
        self.assertEqual(questions[1]["quoremSlug"], "renamed")
        self.assertEqual(questions[1]["observations"], {"30d": 3, "3m": 90})
        self.assertTrue(questions[1]["tagged"])
        self.assertFalse(questions[3]["tagged"])
        self.assertEqual(result["coverage"]["30d"], {"published": 1, "missing": 1})
        self.assertEqual(result["coverage"]["3m"], {"unresolved": 1})
