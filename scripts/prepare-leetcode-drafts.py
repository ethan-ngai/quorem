#!/usr/bin/env python3
"""Prepare incomplete Quorem drafts from staged questions and a pinned test corpus."""

import argparse
import ast
import json
import io
import importlib
import zipfile
import re
import urllib.request
from collections import Counter
from pathlib import Path

REVISION = "215604aeed660029df7de2fea5a4d7b6ed476a08"
BASE = f"https://huggingface.co/datasets/newfacade/LeetCodeDataset/resolve/{REVISION}"
KAMYU = "250c3e8ccc6d40db557684ccb66035d863e72896"


def type_name(node):
    if isinstance(node, ast.Name) and node.id in ("int", "float", "str", "bool"):
        return node.id
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id in ("List", "list", "Optional"):
        inner = type_name(node.slice)
        return ("optional" if node.value.id == "Optional" else "list") + f"<{inner}>" if inner else None
    return None


def signature(starter):
    tree = ast.parse(starter.rstrip() + "\n        pass\n")
    classes = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Solution"]
    if len(classes) != 1:
        raise ValueError("not a Solution method")
    methods = [n for n in classes[0].body if isinstance(n, ast.FunctionDef) and not n.name.startswith("_")]
    if len(methods) != 1:
        raise ValueError("not a single method")
    fn = methods[0]
    if fn.decorator_list or fn.args.posonlyargs or fn.args.defaults or fn.args.kwonlyargs or fn.args.vararg or fn.args.kwarg or not fn.args.args or fn.args.args[0].arg != "self":
        raise ValueError("unsupported parameters")
    params = [{"name": arg.arg, "type": type_name(arg.annotation)} for arg in fn.args.args[1:]]
    result = type_name(fn.returns)
    if not result or any(not arg["type"] for arg in params):
        raise ValueError("unsupported types")
    return {"className": "Solution", "methodName": fn.name, "parameters": params, "returnType": result}


def literal(node):
    value = ast.literal_eval(node)
    json.dumps(value, allow_nan=False)
    if isinstance(value, (tuple, set, dict, bytes, complex)):
        raise ValueError("unsupported literal")
    return value


def case(row, parameters):
    call = ast.parse("candidate(" + row["input"] + ")", mode="eval").body
    if not isinstance(call, ast.Call) or call.args or any(k.arg is None for k in call.keywords):
        raise ValueError("unsupported input")
    values = {k.arg: literal(k.value) for k in call.keywords}
    if len(values) != len(call.keywords) or set(values) != {p["name"] for p in parameters}:
        raise ValueError("wrong input names")
    expected = literal(ast.parse(row["output"], mode="eval").body)
    return {"args": [values[p["name"]] for p in parameters], "expected": expected}



# Corpus preludes are known standard-library imports; never import source-selected modules.
PRELUDE_MODULES = {"typing", "functools", "collections", "itertools", "heapq", "bisect", "string", "operator", "math", "datetime", "random"}


def prelude_for_source(lines, body):
    """Keep referenced prelude bindings, resolving known wildcard imports explicitly."""
    try:
        tree = ast.parse(body)
        if any(isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id in {"eval", "exec", "globals", "locals", "__import__"} for n in ast.walk(tree)):
            return "\n".join(lines) + "\n" if lines else ""
        imports = [ast.parse(line).body[0] for line in lines]
        bindings = {}
        for index, node in enumerate(imports):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name not in PRELUDE_MODULES:
                        raise ValueError("unknown prelude import")
                    bindings[alias.asname or alias.name.split(".")[0]] = index
            elif isinstance(node, ast.ImportFrom) and not node.level and node.module in PRELUDE_MODULES:
                for alias in node.names:
                    if alias.name == "*":
                        module = importlib.import_module(node.module)
                        exports = getattr(module, "__all__", [name for name in vars(module) if not name.startswith("_")])
                        for name in exports:
                            bindings[name] = index
                    else:
                        bindings[alias.asname or alias.name] = index
            elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and ast.unparse(node) == "inf = float('inf')":
                bindings["inf"] = index
            else:
                raise ValueError("unknown prelude statement")
        used = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
        selected = {}
        for name in used:
            if name in bindings:
                selected.setdefault(bindings[name], set()).add(name)
        output = []
        for index, node in enumerate(imports):
            names = selected.get(index, set())
            if not names:
                continue
            if isinstance(node, ast.ImportFrom):
                if any(alias.name == "*" for alias in node.names):
                    output.append(f"from {node.module} import {', '.join(sorted(names))}")
                else:
                    node.names = [alias for alias in node.names if (alias.asname or alias.name) in names]
                    output.append(ast.unparse(node))
            elif isinstance(node, ast.Import):
                node.names = [alias for alias in node.names if (alias.asname or alias.name.split(".")[0]) in names]
                output.append(ast.unparse(node))
            else:
                output.append(lines[index])
        return "\n".join(output) + "\n\n" if output else ""
    except (SyntaxError, ValueError, ImportError, RecursionError):
        return "\n".join(lines) + "\n" if lines else ""


def draft(staged, corpus):
    source = staged["source"]
    starter = corpus.get("starter_code", "")
    sig = signature(starter)
    # The corpus references assume the imports in its prompt, not harness globals.
    prelude = []
    for line in corpus.get("prompt", "").splitlines():
        if line.startswith(("class ", "def ")):
            break
        if line.startswith(("import ", "from ")) or line == "inf = float('inf')":
            prelude.append(line)
    cases = []
    for row in corpus.get("input_output", []):
        try:
            c = case(row, sig["parameters"])
            if c not in cases:
                cases.append(c)
        except (ValueError, SyntaxError, TypeError, KeyError, RecursionError):
            continue
    if not cases:
        raise ValueError("no literal cases")
    statement = corpus.get("problem_description", "")
    reference_body = corpus.get("completion", "")
    starter_body = starter.rstrip() + "\n        pass\n"
    reference = prelude_for_source(prelude, reference_body) + reference_body
    starter_source = prelude_for_source(prelude, starter_body) + starter_body
    if not statement or not reference or len(statement) > 65536 or len(reference) > 65536:
        raise ValueError("missing or oversized content")
    runtime, harness = "python-3.12-v1", "quorem-harness-v2"
    return {
        "problem": {"id": "00000000-0000-4000-8000-000000000000", "slug": "lc-" + source["problem_slug"], "version": "1", "title": source["title"], "difficulty": source["difficulty"].lower(), "tags": [], "companies": staged["companies"], "leetcodeId": staged["leetcode_id"], "statementMarkdown": statement, "examples": [], "constraints": [], "signature": sig, "starterSource": starter_source, "runtimeRevision": runtime, "languages": [], "limits": {"wallTimeMs": 2000, "memoryBytes": 268435456, "outputBytes": 65536, "maxProcesses": 16, "maxCollectionElements": 10000, "maxNestingDepth": 100}},
        "hiddenCases": cases[:20], "comparator": "ordered", "attribution": "LeetCode; reference and cases from newfacade/LeetCodeDataset.",
        "implementations": [{"language": "python", "starterSource": starter_source, "runtimeRevision": runtime, "harnessRevision": harness, "referenceSource": reference}], "solutions": []}


def matches_type(typ, value):
    if typ == "int":
        return type(value) is int and -(2**31) <= value < 2**31
    if typ == "bool":
        return type(value) is bool
    if typ == "float":
        return type(value) in (int, float) and abs(value) < float("inf")
    if typ == "str":
        return isinstance(value, str)
    if typ.startswith("optional<") and typ.endswith(">"):
        return value is None or matches_type(typ[9:-1], value)
    if typ.startswith("list<") and typ.endswith(">"):
        return isinstance(value, list) and len(value) <= 10000 and all(matches_type(typ[5:-1], v) for v in value)
    return False


def checked_case(c, sig):
    return (len(c["args"]) == len(sig["parameters"]) and
            all(matches_type(p["type"], v) for p, v in zip(sig["parameters"], c["args"])) and
            matches_type(sig["returnType"], c["expected"]))


def candidate(content, source, corpus):
    sig = content["problem"]["signature"]
    if sig["returnType"] not in ("int", "bool", "str"):
        raise ValueError("unsupported or ambiguous comparator")
    statement = content["problem"]["statementMarkdown"]
    if re.search(r"\b(any|either|one of|multiple answers|any order)\b", statement, re.I):
        raise ValueError("possibly ambiguous output")
    examples = []
    for example in source.get("examples", []):
        text = example.get("example_text", "")
        match = re.search(r"(?m)^Input:\s*(.+)\nOutput:\s*(.+)$", text)
        if match:
            try:
                parsed = case({"input": match.group(1), "output": match.group(2)}, sig["parameters"])
                if checked_case(parsed, sig) and parsed not in examples:
                    examples.append(parsed)
            except (SyntaxError, ValueError, TypeError, RecursionError):
                pass
    if not examples:
        raise ValueError("no parseable public examples")
    cases = []
    seen = {json.dumps(e["args"], sort_keys=True) for e in examples}
    for row in corpus.get("input_output", []):
        try:
            c = case(row, sig["parameters"])
        except (SyntaxError, ValueError, TypeError, KeyError, RecursionError):
            continue
        key = json.dumps(c["args"], sort_keys=True)
        if key not in seen and checked_case(c, sig):
            seen.add(key)
            cases.append(c)
    if len(cases) < 20:
        raise ValueError("fewer than 20 distinct typed cases")
    content = json.loads(json.dumps(content))
    content["problem"]["examples"] = examples[:20]
    content["hiddenCases"] = cases[:20]
    return content


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("staged", type=Path)
    p.add_argument("output", type=Path)
    args = p.parse_args()
    if args.output.exists():
        p.error("output directory already exists")
    staged = json.loads((args.staged / "questions.json").read_text())
    corpus = {}
    duplicates = set()
    for split in ("train", "test"):
        with urllib.request.urlopen(f"{BASE}/LeetCodeDataset-{split}.jsonl", timeout=120) as response:
            for line in response:
                row = json.loads(line)
                slug = row.get("task_id")
                if slug in corpus:
                    duplicates.add(slug)
                corpus[slug] = row
    with urllib.request.urlopen(f"https://codeload.github.com/kamyu104/LeetCode-Solutions/zip/{KAMYU}", timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    alternatives = {}
    for name in archive.namelist():
        parts = name.split("/")
        if len(parts) == 3 and parts[1] == "Python" and parts[2].endswith(".py"):
            alternatives[parts[2][:-3]] = archive.read(name).decode("utf-8")
    args.output.mkdir(parents=True)
    (args.output / "alternatives").mkdir()
    (args.output / "candidates").mkdir()
    failures = []
    counts = Counter()
    for item in staged:
        slug = item["source"]["problem_slug"]
        row = corpus.get(slug)
        if not row or slug in duplicates or str(row.get("question_id")) != str(item["leetcode_id"]):
            failures.append({"leetcode_id": item["leetcode_id"], "reason": "missing or conflicting corpus identity"})
            continue
        try:
            content = draft(item, row)
        except (ValueError, SyntaxError, TypeError, KeyError, RecursionError) as error:
            failures.append({"leetcode_id": item["leetcode_id"], "reason": str(error)})
            continue
        (args.output / f'{item["leetcode_id"]}.json').write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n")
        if slug in alternatives:
            (args.output / "alternatives" / f'{item["leetcode_id"]}.py').write_text(alternatives[slug], encoding="utf-8")
            counts["kamyu_alternatives"] += 1
        try:
            importable = candidate(content, item["source"], row)
            (args.output / "candidates" / f'{item["leetcode_id"]}.json').write_text(json.dumps(importable, ensure_ascii=False, indent=2) + "\n")
            counts["candidates"] += 1
        except ValueError as error:
            counts["candidate_blocked: " + str(error)] += 1
        counts["drafts"] += 1
        counts["drafts_with_20_cases"] += len(content["hiddenCases"]) == 20
    report = {"corpus": f"https://huggingface.co/datasets/newfacade/LeetCodeDataset/tree/{REVISION}", "alternative_source": f"https://github.com/kamyu104/LeetCode-Solutions/tree/{KAMYU}", "counts": dict(counts), "failures": failures, "publication_ready": False, "limitations": ["Draft examples intentionally empty; candidate examples are parsed from source", "Publicly available generated cases may overlap examples and are not private", "Cases and ordered comparison unverified", "Reference and starter execution unverified", "Company tags are historical source associations"]}
    (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Prepared {counts['drafts']} incomplete drafts; {counts['drafts_with_20_cases']} have 20 cases; {len(failures)} skipped")


if __name__ == "__main__":
    main()
