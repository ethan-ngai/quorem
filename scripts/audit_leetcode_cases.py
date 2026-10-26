"""Conservatively screen sourced question cases; unsupported rules require review."""
import ast
import hashlib
import json
import re

# These exact published references fail valid in-range boundary inputs.
FAILING_REFERENCES = {
    '1254': '8cbdb38883c1a0902c81da3ac67a83136b093994eac33aad02335da98a8a44aa',
    '1376': 'be348a522a8c5fd82e27791be96aade3f214a349fc1acc24a1789ea6ffdb5edb',
    '2472': 'dbc832d71245d45413e50090ee1cf8980a23ef8859dd6fd24fd45e196435b28d',
}


def number(text):
    tree = ast.parse(text.replace('^', '**'), mode='eval').body
    def calc(node):
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -calc(node.operand)
        if isinstance(node, ast.BinOp):
            a, b = calc(node.left), calc(node.right)
            if isinstance(node.op, ast.Mult): return a * b
            if isinstance(node.op, ast.Pow) and 0 <= b <= 12: return a ** b
        raise ValueError('unsupported bound')
    result = calc(tree)
    if abs(result) > 10 ** 15: raise ValueError('bound too large')
    return result


def constraints(problem):
    values = problem.get('constraints', [])
    if values:
        return [x if isinstance(x, str) else x.get('text', '') for x in values]
    statement = problem['statementMarkdown']
    match = re.search(r'\*\*Constraints:\*\*(.*?)(?=\n\s*\*\*[^\n]*:\*\*|\Z)', statement, re.S | re.I)
    if not match:
        return []
    return [re.sub(r'^\s*-\s*', '', line).strip() for line in match.group(1).splitlines() if line.strip()]


def parse_bound(rule, names):
    text = rule.replace('`', '').replace('\u200b', '').strip()
    shape = re.fullmatch(r'([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\[i\]\.length', text)
    if shape and shape.group(1) not in names and shape.group(2) in names:
        return shape.group(2), 'rectangular', 0, 0, False, None, False
    match = re.fullmatch(r'(.+?)\s*(<=|<)\s*([A-Za-z_]\w*(?:\.length|(?:\[[a-zA-Z]+\])+)?)(?:\s*(<=|<)\s*(.+))?', text)
    if not match: return None
    lo, first, target, second, hi = match.groups()
    param = re.match(r'\w+', target).group()
    if param not in names: return None
    try:
        lower, upper = number(lo), number(hi) if hi is not None else None
    except (ValueError, SyntaxError, OverflowError):
        return None
    mode = 'length' if target.endswith('.length') else 'elements' if '[' in target else 'value'
    depth = target.count('[')
    return param, mode, depth, lower, first == '<', upper, second == '<'


def value_satisfies(rule, arguments):
    param, mode, depth, lower, strict_lower, upper, strict_upper = rule
    value = arguments[param]
    if mode == 'rectangular':
        return isinstance(value, list) and all(isinstance(row, list) for row in value) and len({len(row) for row in value}) <= 1
    if mode == 'length':
        if not isinstance(value, (str, list)): return False
        values = [len(value)]
    elif mode == 'elements':
        values = [value]
        for _ in range(depth):
            if not all(isinstance(item, list) for item in values): return False
            values = [item for seq in values for item in seq]
    else:
        values = [value]
    for n in values:
        if type(n) is not int: return False
        if n < lower or (strict_lower and n == lower): return False
        if upper is not None and (n > upper or (strict_upper and n == upper)): return False
    return True


def assess(content):
    p = content['problem']
    names = [x['name'] for x in p['signature']['parameters']]
    texts = constraints(p)
    parsed = [parse_bound(text, names) for text in texts]
    unsupported = [text for text, rule in zip(texts, parsed) if rule is None]
    if not texts: unsupported.append('source constraints missing')
    rules = [x for x in parsed if x is not None]
    seen = {}
    for example in p['examples']:
        key = json.dumps(example['args'], sort_keys=True)
        if key in seen and seen[key] != example.get('expected'):
            unsupported.append('public examples conflict for identical input')
        seen[key] = example.get('expected')
    keep, rejected = [], []
    for index, case in enumerate(content['hiddenCases']):
        key = json.dumps(case['args'], sort_keys=True)
        args = dict(zip(names, case['args']))
        violations = [texts[i] for i, rule in enumerate(parsed) if rule is not None and (len(args) != len(names) or not value_satisfies(rule, args))]
        if key in seen:
            reason = 'duplicate input' if seen[key] == case.get('expected') else 'conflicting expected output'
            rejected.append({'index': index, 'reason': reason})
            if reason == 'conflicting expected output': unsupported.append(reason)
        elif violations:
            rejected.append({'index': index, 'reason': 'violates parsed constraint', 'constraints': violations})
        else:
            keep.append(case)
        if key not in seen: seen[key] = case.get('expected')
    reference = content['implementations'][0]['referenceSource']
    bad = FAILING_REFERENCES.get(str(p.get('leetcodeId'))) == hashlib.sha256(reference.encode()).hexdigest()
    return {'unsupported': unsupported, 'rejected': rejected, 'cases': keep,
            'known_bad_reference': bad, 'verified_constraint_count': len(rules),
            'constraint_screen_passed': not unsupported and not bad and len(keep) == 20}
