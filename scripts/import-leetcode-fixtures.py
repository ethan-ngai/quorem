#!/usr/bin/env python3
"""Import verified fixture drafts into an explicitly selected local Quorem API."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


class ApiError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__(f'API returned HTTP {status}' if status else 'API request outcome unknown')


def request(base, user, method, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=payload, method=method, headers={'Content-Type': 'application/json', 'X-Dev-User': user})
    try:
        with OPENER.open(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise ApiError(error.code) from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise ApiError(None) from error


def read_manifest(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    items, seen_ids, seen_slugs = [], set(), set()
    for entry in manifest['fixtures']:
        name = entry['file']
        if not re.fullmatch(r'[1-9][0-9]*\.json', name):
            raise ValueError('invalid fixture filename')
        data = (directory / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError(f'fixture hash mismatch: {name}')
        content = json.loads(data)
        problem = content['problem']
        identity, slug = problem.get('leetcodeId'), problem['slug']
        if identity != entry['leetcodeId'] or str(identity) != name[:-5] or identity in seen_ids or slug in seen_slugs:
            raise ValueError(f'duplicate or inconsistent fixture identity: {name}')
        if not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', slug):
            raise ValueError(f'invalid slug: {name}')
        seen_ids.add(identity)
        seen_slugs.add(slug)
        items.append((name, entry['sha256'], content))
    if manifest['fixture_count'] != len(items):
        raise ValueError('manifest fixture count mismatch')
    return items


def draft_index(base, user):
    cursor, seen, index = '', set(), {}
    while True:
        query = '?cursor=' + urllib.parse.quote(cursor) if cursor else ''
        page = request(base, user, 'GET', '/v1/admin/question-drafts' + query)
        for item in page['items']:
            index.setdefault(item['slug'], []).append(item)
        cursor = page.get('nextCursor') or ''
        if not cursor:
            return index
        if cursor in seen:
            raise ValueError('draft pagination repeated cursor')
        seen.add(cursor)


def same_fixture(actual, expected):
    a, b = actual['problem'], expected['problem']
    problem_fields = ('leetcodeId', 'slug', 'companies', 'title', 'difficulty', 'tags',
                      'statementMarkdown', 'examples', 'constraints', 'signature')
    content_fields = ('hiddenCases', 'attribution', 'implementations')
    return (all(a.get(field) == b.get(field) for field in problem_fields)
            and all(actual.get(field) == expected.get(field) for field in content_fields))


def save(path, ledger):
    temp = path.with_name(path.name + '.tmp')
    with open(temp, 'w', encoding='utf-8') as f:
        json.dump(ledger, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('directory', type=Path)
    p.add_argument('--target', required=True, help='loopback API origin, e.g. http://127.0.0.1:8080')
    p.add_argument('--dev-user', required=True, help='local development identity with authoring access')
    p.add_argument('--apply', action='store_true', help='create missing drafts; default is dry-run')
    p.add_argument('--publish', choices=('private', 'global'), help='publish drafts after creation; requires --apply')
    p.add_argument('--limit', type=int, default=0, help='process at most this many fixtures')
    args = p.parse_args()
    target = urllib.parse.urlsplit(args.target)
    if target.scheme != 'http' or target.hostname not in ('localhost', '127.0.0.1', '::1') or target.path not in ('', '/') or target.query or target.fragment or target.username or target.password:
        p.error('target must be a loopback HTTP origin')
    if args.publish and not args.apply:
        p.error('--publish requires --apply')
    if args.limit < 0 or not args.dev_user or any(c in args.dev_user for c in '\r\n'):
        p.error('invalid limit or development identity')
    base = args.target.rstrip('/')
    items = read_manifest(args.directory)
    if args.limit:
        items = items[:args.limit]
    ledger_path = args.directory / 'import-ledger.json'
    lock_path = args.directory / '.import.lock'
    if not args.apply:
        print(f'Dry run: {len(items)} manifest-verified fixtures; target {base}; no writes')
        return 0
    failures = 0
    with open(lock_path, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'target': base, 'user': args.dev_user, 'items': {}}
        if ledger['target'] != base or ledger['user'] != args.dev_user:
            raise ValueError('ledger target or identity differs')
        index = draft_index(base, args.dev_user)
        for name, digest, content in items:
            slug = content['problem']['slug']
            state = ledger['items'].get(name, {})
            if state and state.get('sha256') != digest:
                raise ValueError(f'fixture changed since import: {name}')
            try:
                try:
                    published = request(base, args.dev_user, 'GET', '/v1/problems/' + urllib.parse.quote(slug))
                except ApiError as error:
                    if error.status != 404:
                        raise
                    published = None
                if published:
                    if published.get('leetcodeId') != content['problem']['leetcodeId']:
                        raise ValueError('published slug collision')
                    ledger['items'][name] = {'sha256': digest, 'status': 'published', 'version': published.get('id')}
                    save(ledger_path, ledger)
                    continue
                matches = index.get(slug, [])
                if len(matches) > 1:
                    raise ValueError('multiple existing drafts share slug')
                if matches:
                    draft = request(base, args.dev_user, 'GET', '/v1/admin/question-drafts/' + matches[0]['id'])
                    if not same_fixture(draft['content'], content):
                        raise ValueError('existing draft differs')
                else:
                    if state.get('status') == 'creating':
                        raise ValueError('previous creation outcome unknown; resolve before retrying')
                    ledger['items'][name] = {'sha256': digest, 'status': 'creating'}
                    save(ledger_path, ledger)
                    try:
                        draft = request(base, args.dev_user, 'POST', '/v1/admin/question-drafts', {'content': content})
                    except ApiError as error:
                        if error.status is not None and 400 <= error.status < 500:
                            ledger['items'][name] = {'sha256': digest, 'status': 'failed', 'error': str(error)}
                            save(ledger_path, ledger)
                        raise
                    index[slug] = [{'id': draft['id']}]
                ledger['items'][name] = {'sha256': digest, 'status': 'draft', 'id': draft['id'], 'revision': draft['revision']}
                if draft.get('publishedVersionId'):
                    ledger['items'][name].update({'status': 'published', 'version': draft['publishedVersionId']})
                    save(ledger_path, ledger)
                    continue
                save(ledger_path, ledger)
                if args.publish:
                    published_draft = request(base, args.dev_user, 'POST', '/v1/admin/question-drafts/' + draft['id'] + '/publish', {'revision': draft['revision'], 'visibility': args.publish})
                    ledger['items'][name].update({'status': 'published', 'version': published_draft.get('publishedVersionId')})
                    save(ledger_path, ledger)
            except (ApiError, ValueError, KeyError) as error:
                failures += 1
                print(f'{name}: {error}', file=sys.stderr)
        print(f'Processed {len(items)} fixtures; {failures} failures')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
