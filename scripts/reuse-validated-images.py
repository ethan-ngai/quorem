"""Resolve both role images from a successful build with unchanged image inputs."""
import json
import os
import re
import subprocess

WORKFLOW = '.github/workflows/deploy.yaml'
BUILD_IF = "    if: ${{ !inputs.reuse_run_id }}\n"
# Worker modules ship through Terraform, not the container images. The profiler
# is a separate main package, unreachable from either production Go entrypoint.
IMAGE_INPUTS = [
    'apps/api', ':(exclude)apps/api/cmd/profile-reads',
    'apps/auth', 'apps/runner', 'internal', 'fixtures', 'packages/contracts',
    'deploy/Dockerfile', 'deploy/Dockerfile.direct-judge', 'deploy/Dockerfile.case',
    'deploy/start.py', 'deploy/direct-judge-start.py', 'deploy/cgroup.py', 'deploy/seccomp.py', 'deploy/nginx.conf',
    'deploy/runtime-deps',
    'go.mod', 'go.sum', '.node-version', 'package.json',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'scripts/package-auth.py', 'scripts/build-judge-images.py',
]

REQUIRED_STEPS = {
    'Validate application and judge', 'Build application and judge images',
    'Verify split runtime roles', 'Verify direct sandbox isolation',
    'Push application and judge images',
}


def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()


def github(path):
    try:
        result = subprocess.run(['gh', 'api', path], check=True, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if len(result.stdout) > 2_000_000:
            raise RuntimeError('Workflow metadata exceeded its bound')
        return json.loads(result.stdout)
    except (subprocess.CalledProcessError, ValueError):
        raise RuntimeError('Unable to read validated workflow metadata') from None


def build_definition(text):
    try:
        return text.split('\n  build:\n', 1)[1].split('\n  deploy:\n', 1)[0].replace(BUILD_IF, '')
    except IndexError:
        raise RuntimeError('Deployment build definition missing') from None


def resolve(run_id, current, repository, api=github, command=git):
    if not re.fullmatch(r'[0-9]{1,20}', run_id) or not re.fullmatch(r'[0-9a-f]{40}', current):
        raise RuntimeError('Invalid release identifiers')
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repository):
        raise RuntimeError('Invalid release repository')
    path = f'repos/{repository}/actions/runs/{run_id}'
    run = api(path)
    source = run.get('head_sha', '')
    if (run.get('path') != WORKFLOW or run.get('head_branch') != 'main'
            or run.get('status') != 'completed'
            or run.get('head_repository', {}).get('full_name') != repository
            or not re.fullmatch(r'[0-9a-f]{40}', source)):
        raise RuntimeError('Selected run is not a completed main deployment build')
    jobs = api(path + '/jobs?per_page=100&filter=latest')
    build = next((job for job in jobs.get('jobs', []) if job.get('name') == 'build'), {})
    succeeded = {step.get('name') for step in build.get('steps', []) if step.get('conclusion') == 'success'}
    if build.get('conclusion') != 'success' or not REQUIRED_STEPS <= succeeded:
        raise RuntimeError('Both role images must have passed verification and publication')
    try:
        command('merge-base', '--is-ancestor', source, current)
        command('diff', '--quiet', source, current, '--', *IMAGE_INPUTS)
        before = command('show', source + ':' + WORKFLOW)
        after = command('show', current + ':' + WORKFLOW)
        if build_definition(before) != build_definition(after):
            raise RuntimeError('Image build steps changed; rebuild required')
    except subprocess.CalledProcessError:
        raise RuntimeError('Image inputs changed or source is not an ancestor; rebuild required') from None
    return source


def main():
    current = os.environ['GITHUB_SHA']
    if git('rev-parse', 'HEAD') != current:
        raise RuntimeError('Checkout must match the current release')
    revision = resolve(os.environ['REUSE_RUN_ID'], current, os.environ['GITHUB_REPOSITORY'])
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        output.write('IMAGE_REVISION=' + revision + '\n')
    print('Reusing both verified role images from ' + revision)


if __name__ == '__main__':
    main()
