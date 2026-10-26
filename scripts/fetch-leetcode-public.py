#!/usr/bin/env python3
"""Cache bounded public LeetCode GraphQL responses for staged questions."""
import argparse
import datetime
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

QUERY = "query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug content isPaidOnly codeSnippets { langSlug code } } }"


def fetch(slug):
    payload = json.dumps({"query": QUERY, "variables": {"titleSlug": slug}}).encode()
    for attempt in range(3):
        request = urllib.request.Request("https://leetcode.com/graphql/", data=payload, headers={"Content-Type": "application/json", "User-Agent": "Quorem public problem research"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = json.load(response)
            if data.get("errors") or not data.get("data", {}).get("question"):
                raise ValueError("missing question or GraphQL error")
            return data["data"]["question"]
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("staged", type=Path)
    p.add_argument("cache", type=Path)
    p.add_argument("--limit", type=int, default=10, help="maximum uncached requests, 1-100")
    args = p.parse_args()
    if not 1 <= args.limit <= 100:
        p.error("limit must be between 1 and 100")
    records = json.loads((args.staged / "questions.json").read_text())
    args.cache.mkdir(parents=True, exist_ok=True)
    requested = 0
    for record in records:
        path = args.cache / f'{record["leetcode_id"]}.json'
        if path.exists():
            continue
        if requested == args.limit:
            break
        slug = record["source"]["problem_slug"]
        requested += 1
        try:
            question = fetch(slug)
            if str(question.get("questionFrontendId")) != str(record["leetcode_id"]) or question.get("titleSlug") != slug:
                raise ValueError("source identity mismatch")
            if question.get("isPaidOnly"):
                question["content"] = None
                question["codeSnippets"] = []
            data = {"url": "https://leetcode.com/graphql/", "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "question": question}
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except (ValueError, urllib.error.URLError, TimeoutError) as error:
            print(f'{record["leetcode_id"]}: {error}')
        time.sleep(1)
    print(f"Attempted {requested} uncached questions")


if __name__ == "__main__":
    main()
