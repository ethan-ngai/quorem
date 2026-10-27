#!/usr/bin/env python3
"""Stage pinned LeetCode source snapshots for review; never write to Quorem."""

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

SOURCES = {
    "questions": ("neenza/leetcode-problems", "16c26d1bcfdc17a0290f7083e86c4e9387b2e248"),
    "companies": ("liquidslr/leetcode-company-wise-problems", "2b71796266751b4736a7ef180efb6847879166ee"),
}


def archive(repo, commit):
    url = f"https://codeload.github.com/{repo}/zip/{commit}"
    with urllib.request.urlopen(url, timeout=120) as response:
        return zipfile.ZipFile(io.BytesIO(response.read()))


def problem_slug(link):
    parsed = urlparse(link)
    if parsed.scheme not in ("https", "http") or parsed.hostname not in ("leetcode.com", "www.leetcode.com"):
        return None
    match = re.fullmatch(r"/problems/([a-z0-9-]+)/?", parsed.path)
    return match.group(1) if match else None


def stage(questions, company_files):
    issues = []
    slug_counts = Counter(q.get("problem_slug") for q in questions if isinstance(q, dict))
    id_counts = Counter(q.get("frontend_id") for q in questions if isinstance(q, dict))
    records = {}
    for q in questions:
        if not isinstance(q, dict):
            issues.append({"kind": "invalid_question", "value": repr(q)})
            continue
        slug, frontend_id = q.get("problem_slug"), q.get("frontend_id")
        if (not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9-]+", slug)
                or not isinstance(frontend_id, str) or not re.fullmatch(r"[1-9][0-9]*", frontend_id)
                or slug_counts[slug] != 1 or id_counts[frontend_id] != 1):
            issues.append({"kind": "invalid_or_duplicate_question", "slug": slug, "frontend_id": frontend_id})
            continue
        records[slug] = {"leetcode_id": int(frontend_id), "source": q, "companies": []}

    pairs = set()
    for company, filename, content in sorted(company_files):
        reader = csv.DictReader(io.StringIO(content, newline=""))
        if not reader.fieldnames or "Link" not in reader.fieldnames:
            issues.append({"kind": "invalid_csv", "file": filename})
            continue
        for row_number, row in enumerate(reader, 2):
            slug = problem_slug(row.get("Link") or "")
            if slug is None or slug not in records:
                issues.append({"kind": "unmatched_company_row", "file": filename, "row": row_number, "link": row.get("Link")})
                continue
            pairs.add((slug, company))
    for slug, company in sorted(pairs):
        records[slug]["companies"].append(company)
    return sorted(records.values(), key=lambda x: x["leetcode_id"]), issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new local directory for staged JSON and report")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output directory already exists")
    question_zip = archive(*SOURCES["questions"])
    company_zip = archive(*SOURCES["companies"])
    question_files = [n for n in question_zip.namelist() if n.count("/") == 1 and n.endswith("/merged_problems.json")]
    if len(question_files) != 1:
        raise ValueError("expected one merged_problems.json")
    questions = json.loads(question_zip.read(question_files[0]))["questions"]
    if not isinstance(questions, list):
        raise ValueError("questions must be an array")
    company_files = []
    for name in company_zip.namelist():
        parts = name.split("/")
        if len(parts) == 3 and parts[2] == "5. All.csv":
            company_files.append((parts[1], name, company_zip.read(name).decode("utf-8-sig")))
    if not company_files:
        raise ValueError("no company All.csv files found")
    records, issues = stage(questions, company_files)
    report = {
        "sources": {name: {"repository": f"https://github.com/{repo}", "commit": commit} for name, (repo, commit) in SOURCES.items()},
        "company_files": len(company_files), "questions": len(records),
        "company_links": sum(len(q["companies"]) for q in records),
        "issues": issues,
        "publication_ready": False,
        "limitations": ["No private tests or reference solutions", "Source content and examples require validation"],
    }
    args.output.mkdir(parents=True)
    for filename, data in (("questions.json", records), ("report.json", report)):
        (args.output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Staged {len(records)} questions and {report['company_links']} links; {len(issues)} issues in {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
