import copy
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('reuse', pathlib.Path(__file__).with_name('reuse-validated-images.py'))
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)


class ReuseImagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.workflow = 'name: Deploy\njobs:\n  build:\n    steps:\n      - run: echo compile\n\n  deploy:\n    steps: []\n'
        for path, data in {
            reuse.WORKFLOW: self.workflow,
            'apps/api/entry.go': 'package main\n',
            'deploy/Dockerfile': 'FROM scratch\n',
            'deploy/README.md': 'Documentation\n',
            'pnpm-lock.yaml': 'lockfileVersion: 9\n',
        }.items():
            self.write(path, data)
        self.source = self.commit()
        self.write(reuse.WORKFLOW, self.workflow.replace('  build:\n', '  build:\n' + reuse.BUILD_IF))
        self.write('infra/database.tf', 'suspend_timeout_seconds = 0\n')
        self.write('deploy/README.md', 'Updated account policy documentation\n')
        self.current = self.commit()
        self.run = {'head_sha': self.source, 'path': reuse.WORKFLOW, 'head_branch': 'main',
                    'status': 'completed', 'head_repository': {'full_name': 'fixture/project'}}
        self.jobs = {'jobs': [{'name': 'build', 'conclusion': 'success', 'steps': [
            {'name': name, 'conclusion': 'success'} for name in reuse.REQUIRED_STEPS]}]}

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip()

    def write(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        return self.git('rev-parse', 'HEAD')

    def resolve(self, run_id='123'):
        def api(path):
            return self.jobs if '/jobs?' in path else self.run
        return reuse.resolve(run_id, self.current, 'fixture/project', api, self.git)

    def test_infrastructure_and_documentation_retry_reuses_both_images(self):
        self.assertEqual(self.resolve(), self.source)

    def test_wrong_branch_workflow_repository_or_incomplete_run_is_rejected(self):
        for key, value in [('head_branch', 'dev'), ('path', '.github/workflows/other.yaml'),
                           ('status', 'in_progress'), ('head_repository', {'full_name': 'other/project'})]:
            with self.subTest(key=key):
                original = self.run[key]
                self.run[key] = value
                with self.assertRaises(RuntimeError): self.resolve()
                self.run[key] = original

    def test_failed_build_or_skipped_role_verification_is_rejected(self):
        original = copy.deepcopy(self.jobs)
        self.jobs['jobs'][0]['conclusion'] = 'failure'
        with self.assertRaises(RuntimeError): self.resolve()
        self.jobs = original
        self.jobs['jobs'][0]['steps'][0]['conclusion'] = 'skipped'
        with self.assertRaises(RuntimeError): self.resolve()

    def test_changed_runtime_docker_or_dependency_inputs_are_rejected(self):
        baseline = self.current
        for path in ['apps/api/entry.go', 'deploy/Dockerfile', 'pnpm-lock.yaml']:
            with self.subTest(path=path):
                self.git('reset', '--hard', baseline)
                self.write(path, 'changed input\n')
                self.current = self.commit()
                with self.assertRaisesRegex(RuntimeError, 'Image inputs changed'): self.resolve()

    def test_changed_image_build_commands_are_rejected(self):
        self.write(reuse.WORKFLOW, self.workflow.replace('echo compile', 'echo different build'))
        self.current = self.commit()
        with self.assertRaisesRegex(RuntimeError, 'build steps changed'): self.resolve()

    def test_nonancestor_and_invalid_run_identifiers_are_rejected(self):
        self.run['head_sha'] = 'a' * 40
        with self.assertRaisesRegex(RuntimeError, 'not an ancestor'): self.resolve()
        for value in ['../outside', '123?extra=true', '']:
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, 'Invalid release identifiers'): self.resolve(value)


if __name__ == '__main__':
    unittest.main()
