#!/usr/bin/env python3
"""Rank company evidence and compare it with published global Classic questions."""

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

DEFAULT_COMPANIES = ("Amazon", "Apple", "Google", "Meta", "Microsoft", "Netflix")
CATALOG_QUERY = {"library": "global", "type": "classic", "sort": "title", "limit": 100}


def load_catalog(origin):
    origin = origin.rstrip("/")
    url = urlsplit(origin)
    if (
        url.scheme not in {"http", "https"} or not url.hostname
        or url.path or url.query or url.fragment or url.username is not None
    ):
        raise ValueError("expected a catalog origin such as https://quorem.app")
    items, seen, total, page = [], set(), None, 1
    while True:
        query = urlencode({**CATALOG_QUERY, "page": page})
        request = Request(f"{origin}/v1/problems?{query}", headers={
            "Accept": "application/json",
            "User-Agent": "QuoremCompanyCoverage/1.0",
        })
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
        if total is None:
            total = payload["total"]
        batch = payload["items"]
        expected = min(CATALOG_QUERY["limit"], total - len(items))
        ids = {item["id"] for item in batch}
        if payload["total"] != total or payload["page"] != page or (
            len(batch) != expected or len(ids) != len(batch) or ids & seen
        ):
            raise ValueError("catalog changed during pagination or returned an incomplete page")
        items.extend(batch)
        seen.update(ids)
        if len(items) == total:
            return items
        page += 1


def audit(evidence, catalog, companies):
    published = {}
    for item in catalog:
        leetcode_id = item.get("leetcodeId")
        if leetcode_id is None:
            continue
        if leetcode_id in published:
            raise ValueError(f"duplicate published LeetCode ID {leetcode_id}")
        published[leetcode_id] = item

    window_rank = {window: index for index, window in enumerate(evidence["windows"])}
    selected = {company.casefold(): {} for company in companies}
    for row in evidence["rows"]:
        rows = selected.get(row["company"].casefold())
        if rows is None:
            continue
        slug = row["leetcodeSlug"]
        rows.setdefault(slug, []).append(row)

    results = []
    for company in companies:
        rows = selected[company.casefold()]
        if not rows:
            raise ValueError(f"no source evidence for {company}")
        questions = []
        counts = {window: Counter() for window in evidence["windows"]}
        for observations in rows.values():
            # Source windows overlap. Count each question once, in its shortest observed window.
            observations.sort(key=lambda row: window_rank[row["window"]])
            best = observations[0]
            leetcode_id = best["leetcodeId"]
            item = published.get(leetcode_id)
            status = "published" if item else ("missing" if leetcode_id is not None else "unresolved")
            counts[best["window"]][status] += 1
            tags = item.get("companies", []) if item else []
            tagged = any(tag.casefold() == company.casefold() for tag in tags) if item else None
            questions.append({
                "leetcodeId": leetcode_id,
                "leetcodeSlug": best["leetcodeSlug"],
                "title": best["title"],
                "window": best["window"],
                "frequency": best["frequency"],
                "observations": {row["window"]: row["frequency"] for row in observations},
                "status": status,
                "quoremSlug": item["slug"] if item else None,
                "tagged": tagged,
            })
        questions.sort(key=lambda row: (window_rank[row["window"]], -row["frequency"], row["leetcodeSlug"]))
        results.append({"company": company, "coverage": counts, "questions": questions})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--catalog-origin", required=True)
    parser.add_argument("--company", action="append", help="company name, repeat to select several")
    args = parser.parse_args()
    companies = args.company or DEFAULT_COMPANIES
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    catalog = load_catalog(args.catalog_origin)
    report = {
        "source": evidence["source"],
        "identitySource": evidence["identitySource"],
        "evidenceIssues": evidence["issues"],
        "catalog": {
            "origin": args.catalog_origin.rstrip("/"),
            "query": CATALOG_QUERY,
            "readAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "total": len(catalog),
            "withLeetcodeId": sum(item.get("leetcodeId") is not None for item in catalog),
        },
        "companies": audit(evidence, catalog, companies),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
