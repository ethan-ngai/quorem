"""Verify the application rollout and the active judge Worker version."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import quote
from cloudflare_api import get

spec = importlib.util.spec_from_file_location('worker_upload', Path(__file__).with_name('upload-worker-version.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)

roles = json.loads(subprocess.check_output([
    'terraform', '-chdir=infra/terraform/app', 'output', '-json', 'runtime_rollouts',
], text=True))
if set(roles) != {'app', 'judge'}:
    raise SystemExit('Both application and judge targets must be configured')
account = os.environ['CLOUDFLARE_ACCOUNT_ID']
app = roles['app']
path = f"/accounts/{account}/containers/applications/{app['application_id']}"
deadline = time.monotonic() + 480
while time.monotonic() < deadline:
    state = get(path + '/rollouts/' + app['rollout_id'])
    if state['status'] in ('failed', 'cancelled', 'replaced'):
        raise SystemExit('Application rollout did not complete: ' + state['status'])
    if state['status'] == 'completed':
        if get(path)['configuration']['image'] != app['image']:
            raise SystemExit('Application image differs from Terraform target')
        break
    time.sleep(5)
else:
    raise SystemExit('Application rollout timed out')

judge = roles['judge']
for key in ('application_id', 'case_application_id'):
    target = get(f"/accounts/{account}/containers/applications/{judge[key]}")
    if target.get('scheduling_policy') != 'durable_object':
        raise SystemExit('Judge application has the wrong scheduling policy')
worker = quote(judge['worker'], safe='')
base = f'/accounts/{account}/workers/scripts/{worker}'
deployments = get(base + '/deployments').get('deployments', [])
if not deployments:
    raise SystemExit('Worker has no deployment')
versions = deployments[0].get('versions', [])
if len(versions) != 1 or versions[0].get('percentage') != 100:
    raise SystemExit('Worker deployment is not a single complete version')
version = get(base + '/versions/' + quote(versions[0]['version_id'], safe=''))
runtime = version.get('resources', {}).get('script_runtime', {})
containers = {item.get('class_name'): item for item in runtime.get('containers', [])}
expected = {'FastJudge': {'judge': judge['image']}, 'CaseSandbox': {
    language: f"registry.cloudflare.com/{account}/quorem-case-{language}:{judge['case_revision']}"
    for language in ('python', 'java', 'typescript', 'ocaml', 'postgresql')
}}
for name, images in expected.items():
    actual = containers.get(name, {}).get('images', {})
    for key, tagged in images.items():
        prefix = f'registry.cloudflare.com/{account}/'
        if not tagged.startswith(prefix):
            raise SystemExit('Unexpected image registry')
        repository, tag = tagged[len(prefix):].rsplit(':', 1)
        pinned = uploader.resolve_image(account, os.environ['CLOUDFLARE_API_TOKEN'], repository, tag)
        if actual.get(key) != pinned:
            raise SystemExit(f'{name} {key} image differs from the release')
bindings = version.get('resources', {}).get('bindings', [])
for name, class_name in (('JUDGES', 'FastJudge'), ('CASES', 'CaseSandbox')):
    if not any(binding.get('name') == name and binding.get('class_name') == class_name for binding in bindings):
        raise SystemExit('Active Worker binding differs from the release')
print('Application rollout and direct judge Worker version verified')
