"""Conservatively screen sourced question cases; unsupported rules require review."""
import ast
import hashlib
import json
import math
import re

# These exact published references fail valid in-range boundary inputs.
FAILING_REFERENCES = {
    '1254': '8cbdb38883c1a0902c81da3ac67a83136b093994eac33aad02335da98a8a44aa',
    '1376': 'be348a522a8c5fd82e27791be96aade3f214a349fc1acc24a1789ea6ffdb5edb',
    '2472': 'dbc832d71245d45413e50090ee1cf8980a23ef8859dd6fd24fd45e196435b28d',
}


def numeric(value):
    return type(value) is int or (type(value) is float and math.isfinite(value))


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


def parse_extra(rule, names):
    text = rule.replace('`', '').replace('\u200b', '').strip()
    alphabet = re.fullmatch(r'([A-Za-z_]\w*)\s+(?:consists of|consists only of|consists|contains)\s+(?:only |of only |of )?(?:English lowercase|lowercase English) letters(?: only)?\.?', text, re.I)
    if alphabet and alphabet.group(1) in names:
        return ('alphabet', alphabet.group(1))
    row = re.fullmatch(r'([A-Za-z_]\w*)\[i\]\.length\s*==\s*(\d+)', text)
    if row and row.group(1) in names:
        return ('row-length', row.group(1), int(row.group(2)))
    multi = re.fullmatch(r'(.+?)\s*(<=|<)\s*([A-Za-z_]\w*(?:\.length)?(?:\s*,\s*[A-Za-z_]\w*(?:\.length)?)+)\s*(<=|<)\s*(.+)', text)
    if multi:
        lo, op1, targets, op2, hi = multi.groups()
        text = f'{lo} {op1} ({targets}) {op2} {hi}'
    try:
        tree = ast.parse(text.replace('^', '**'), mode='eval').body
    except (SyntaxError, ValueError):
        return None
    if not isinstance(tree, ast.Compare) or not all(isinstance(op, (ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq)) for op in tree.ops):
        return None

    def allowed(node):
        if isinstance(node, ast.Constant): return type(node.value) is int and abs(node.value) <= 10 ** 15
        if isinstance(node, ast.Name): return node.id in names
        if isinstance(node, ast.Attribute): return node.attr == 'length' and isinstance(node.value, ast.Name) and node.value.id in names
        if isinstance(node, ast.UnaryOp): return isinstance(node.op, ast.USub) and allowed(node.operand)
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Pow):
                return (isinstance(node.left, ast.Constant) and type(node.left.value) is int and
                        isinstance(node.right, ast.Constant) and type(node.right.value) is int and
                        abs(node.left.value) <= 10 ** 15 and 0 <= node.right.value <= 63 and
                        abs(node.left.value ** node.right.value) <= 10 ** 15)
            return isinstance(node.op, (ast.Add, ast.Sub, ast.Mult)) and allowed(node.left) and allowed(node.right)
        if isinstance(node, ast.Tuple): return 1 < len(node.elts) <= 8 and all(allowed(x) for x in node.elts)
        return False

    operands = [tree.left] + tree.comparators
    if not all(allowed(node) for node in operands) or sum(isinstance(node, ast.Tuple) for node in operands) > 1:
        return None
    return ('comparison', tree)


def extra_satisfies(rule, arguments):
    if rule[0] == 'alphabet':
        value = arguments[rule[1]]
        return isinstance(value, str) and all('a' <= c <= 'z' for c in value)
    if rule[0] == 'row-length':
        value = arguments[rule[1]]
        return isinstance(value, list) and all(isinstance(row, (list, str)) and len(row) == rule[2] for row in value)

    def calc(node):
        if isinstance(node, ast.Constant): return node.value
        if isinstance(node, ast.Name):
            value = arguments[node.id]
            if not numeric(value): raise ValueError('non-numeric value')
            return value
        if isinstance(node, ast.Attribute):
            value = arguments[node.value.id]
            if not isinstance(value, (str, list)): raise ValueError('invalid length')
            return len(value)
        if isinstance(node, ast.Tuple): return [calc(x) for x in node.elts]
        if isinstance(node, ast.UnaryOp): return -calc(node.operand)
        a, b = calc(node.left), calc(node.right)
        if isinstance(node.op, ast.Add): return a + b
        if isinstance(node.op, ast.Sub): return a - b
        if isinstance(node.op, ast.Mult): return a * b
        return a ** b

    tree = rule[1]
    try:
        operands = [calc(node) for node in [tree.left] + tree.comparators]
        for a, op, b in zip(operands, tree.ops, operands[1:]):
            aa, bb = a if isinstance(a, list) else [a], b if isinstance(b, list) else [b]
            for left in aa:
                for right in bb:
                    if isinstance(op, ast.Lt) and not left < right: return False
                    if isinstance(op, ast.LtE) and not left <= right: return False
                    if isinstance(op, ast.Gt) and not left > right: return False
                    if isinstance(op, ast.GtE) and not left >= right: return False
                    if isinstance(op, ast.Eq) and not left == right: return False
                    if isinstance(op, ast.NotEq) and not left != right: return False
        return True
    except (ValueError, TypeError, KeyError, OverflowError):
        return False


def value_satisfies(rule, arguments):
    if len(rule) != 7:
        return extra_satisfies(rule, arguments)
    param, mode, depth, lower, strict_lower, upper, strict_upper = rule
    if param not in arguments:
        return False
    value = arguments[param]
    if mode == 'rectangular':
        return isinstance(value, list) and all(isinstance(row, (list, str)) for row in value) and len({len(row) for row in value}) <= 1
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
        if not numeric(n): return False
        if n < lower or (strict_lower and n == lower): return False
        if upper is not None and (n > upper or (strict_upper and n == upper)): return False
    return True


def assess(content):
    p = content['problem']
    names = [x['name'] for x in p['signature']['parameters']]
    texts = constraints(p)
    aliases = {}
    for text in texts:
        match = re.fullmatch(r'([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\.length', text.replace('`', '').strip())
        if match and match.group(1) not in names and match.group(2) in names:
            aliases.setdefault(match.group(1), match.group(2))
    identifiers = names + list(aliases)
    parsed = [parse_bound(text, identifiers) or parse_extra(text, identifiers) for text in texts]
    unsupported = [text for text, rule in zip(texts, parsed) if rule is None]
    if not texts: unsupported.append('source constraints missing')
    rules = [x for x in parsed if x is not None]
    def violated(case):
        args = dict(zip(names, case['args']))
        for alias, source in aliases.items():
            value = args.get(source)
            if isinstance(value, (list, str)): args[alias] = len(value)
        return [texts[i] for i, rule in enumerate(parsed) if rule is not None and (len(case['args']) != len(names) or not value_satisfies(rule, args))]

    invalid_examples = [{'index': index, 'constraints': errors} for index, case in enumerate(p['examples']) if (errors := violated(case))]
    if invalid_examples: unsupported.append('public example violates parsed constraint')
    seen = {}
    for example in p['examples']:
        key = json.dumps(example['args'], sort_keys=True)
        if key in seen and seen[key] != example.get('expected'):
            unsupported.append('public examples conflict for identical input')
        seen[key] = example.get('expected')
    keep, rejected = [], []
    for index, case in enumerate(content['hiddenCases']):
        key = json.dumps(case['args'], sort_keys=True)
        violations = violated(case)
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
    return {'unsupported': unsupported, 'invalid_examples': invalid_examples, 'rejected': rejected, 'cases': keep,
            'known_bad_reference': bad, 'verified_constraint_count': len(rules),
            'constraint_screen_passed': not unsupported and not bad and len(keep) == 20}
