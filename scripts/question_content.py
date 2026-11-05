"""Shared access to approach-owned question solutions for catalog tooling."""


def canonical_approach(content):
    return next(item for item in content['approaches'] if item['id'] == content['canonicalApproachId'])


def canonical_implementation(content):
    language = 'postgresql' if content.get('problem', {}).get('sql') else 'python'
    return next(item for item in canonical_approach(content)['implementations'] if item['language'] == language)
