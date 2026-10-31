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
    subprocess.run(['node', '--experimental-strip-types', 'apps/api/src/cli/profile-reads.ts'], env={**os.environ, 'DATABASE_URL': uri}, check=True)


if __name__ == '__main__':
    main()
