"""Fetch a connection URI inside Actions; print only read-only query timing metrics."""
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def main():
    project = os.environ['NEON_PROJECT_ID']
    if not re.fullmatch(r'[a-z0-9-]{1,60}', project):
        raise RuntimeError('Invalid Neon project identifier')
    opener = urllib.request.build_opener(NoRedirect())

    def get(path):
        request = urllib.request.Request(
            'https://console.neon.tech/api/v2' + path,
            headers={'Authorization': 'Bearer ' + os.environ['NEON_API_KEY']})
        with opener.open(request, timeout=20) as response:
            return json.loads(response.read(65536))

    branches = get(f'/projects/{project}/branches').get('branches', [])
    defaults = [branch for branch in branches if branch.get('default') or branch.get('primary')]
    if len(defaults) != 1:
        raise RuntimeError('Cannot identify the production default branch')
    branch = defaults[0]['id']
    load = os.environ.get('QUOREM_DATABASE_LOAD') == 'true'
    if load:
        endpoints = get(f'/projects/{project}/branches/{branch}/endpoints')['endpoints']
        fields = ('type', 'current_state', 'suspend_timeout_seconds',
                  'autoscaling_limit_min_cu', 'autoscaling_limit_max_cu')
        print(json.dumps([{key: ep.get(key) for key in fields} for ep in endpoints]), flush=True)
    databases = get(f'/projects/{project}/branches/{branch}/databases').get('databases', [])
    candidates = [database for database in databases if database.get('name') != 'postgres']
    selected = os.environ.get('NEON_DATABASE_NAME')
    if selected:
        candidates = [database for database in candidates if database.get('name') == selected]
    if len(candidates) != 1:
        raise RuntimeError('Ambiguous production database; set NEON_DATABASE_NAME')
    database = candidates[0]
    query = urllib.parse.urlencode({'branch_id': branch, 'database_name': database['name'],
                                   'role_name': database['owner_name']})
    data = get(f'/projects/{project}/connection_uri?{query}')
    uri = data.get('uri')
    if not isinstance(uri, str) or not uri.startswith(('postgres://', 'postgresql://')):
        raise RuntimeError('Neon did not return a connection URI')
    print('::add-mask::' + uri, flush=True)
    if load:
        result = subprocess.run(
            ['psql', '-X', '-d', uri, '-v', 'ON_ERROR_STOP=1', '-f', 'scripts/production-database-load.sql'],
            env={**os.environ, 'PGCONNECT_TIMEOUT': '10'}, check=False)
        raise SystemExit(result.returncode)
    match = os.environ.get('QUOREM_DIAGNOSTIC_MATCH_ID')
    if match:
        if not re.fullmatch(r'[0-9a-fA-F-]{36}', match):
            raise RuntimeError('Invalid match identifier')
        result = subprocess.run(
            ['psql', '-X', '-d', uri, '-v', 'ON_ERROR_STOP=1', '-v', 'match_id=' + match,
             '-f', 'scripts/production-match-attempts.sql'],
            env={**os.environ, 'PGCONNECT_TIMEOUT': '10'}, check=False)
        if result.returncode:
            raise SystemExit(result.returncode)
        return
    script = ('scripts/hono-production-benchmark-timing.mjs' if os.environ.get('QUOREM_BENCHMARK_START')
              else 'apps/api/src/cli/profile-reads.ts')
    subprocess.run(['node', '--experimental-strip-types', script], env={**os.environ, 'DATABASE_URL': uri}, check=True)


if __name__ == '__main__':
    main()
