"""Run with python3 apps/runner/tests/test_generic_nodes.py from the repository root."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps/runner/polyglot'))

import dynamic_java
import dynamic_ocaml
import dynamic_typescript
import harness


def signature(name, *types, result):
    return {
        'className': 'Solution',
        'methodName': name,
        'parameters': [{'name': 'arg' + str(i), 'type': kind} for i, kind in enumerate(types)],
        'returnType': result,
    }


SOURCES = {
    'python': '''
class Solution:
    def tree(self, root, legacy):
        root.right.val += str(legacy.val + 1)
        return root

    def linked(self, root):
        root.val += 1
        return root
''',
    'java': '''
class Solution {
    TypedTreeNode<String> tree(TypedTreeNode<String> root, TreeNode legacy) {
        root.right.val += legacy.val + 1;
        return root;
    }

    TypedListNode<Long> linked(TypedListNode<Long> root) {
        root.val += 1L;
        return root;
    }
}
''',
    'typescript': '''
class Solution {
    tree(root: TreeNode<string>, legacy: TreeNode) {
        root.right!.val += legacy.val + 1;
        return root;
    }

    linked(root: ListNode<bigint>) {
        root.val += 1n;
        return root;
    }
}
''',
    'ocaml': '''
let tree (root : string typed_tree_node option) (legacy : tree_node option) =
  let node = Option.get (Option.get root).right in
  node.value <- node.value ^ string_of_int ((Option.get legacy).value + 1);
  root

let linked (root : int64 typed_list_node option) =
  let node = Option.get root in
  node.value <- Int64.succ node.value;
  root
''',
}


class GenericNodesTest(unittest.TestCase):
    def test_sparse_tree_and_lossless_list_round_trip(self):
        tree = signature('tree', 'TreeNode<str>', 'TreeNode', result='TreeNode<str>')
        linked = signature('linked', 'ListNode<long>', result='ListNode<long>')
        methods = {'tree': tree, 'linked': linked}
        calls = [
            {'methodName': 'tree', 'args': [['a', None, 'b'], [2]]},
            {'methodName': 'linked', 'args': [['9007199254740992', '-9223372036854775808']]},
        ]
        expected = [['a', None, 'b3'], ['9007199254740993', '-9223372036854775808']]
        for language, source in SOURCES.items():
            with self.subTest(language=language), tempfile.TemporaryDirectory() as path:
                work = Path(path)
                request = {'signature': tree, 'methods': methods, 'source': source}
                env = dict(os.environ, PYTHONPATH=str(ROOT / 'internal/execution/public'))
                if language == 'python':
                    command = [sys.executable, str(ROOT / 'apps/runner/python/harness.py')]
                    request['calls'] = calls
                elif language == 'java':
                    (work / 'Main.java').write_text(dynamic_java.source(request, vars(harness)))
                    subprocess.run(['javac', 'Main.java'], cwd=work, check=True, timeout=30)
                    command = ['java', '-cp', '.', 'Main']
                elif language == 'typescript':
                    (work / 'main.ts').write_text(dynamic_typescript.source(request, vars(harness)))
                    tsc = ROOT / 'apps/web/node_modules/.bin/tsc'
                    subprocess.run([
                        str(tsc), '--strict', '--target', 'ES2022', '--module', 'commonjs',
                        '--skipLibCheck', 'main.ts',
                    ], cwd=work, check=True, timeout=30)
                    command = ['node', 'main.js']
                else:
                    (work / 'main.ml').write_text(dynamic_ocaml.source(request, vars(harness)))
                    subprocess.run([
                        'ocamlc', '-I', '+unix', '-o', 'main.byte', 'unix.cma', 'main.ml',
                    ], cwd=work, check=True, timeout=30)
                    command = ['ocamlrun', 'main.byte']
                data = request if language == 'python' else {'calls': calls}
                result = subprocess.run(
                    command, cwd=work, env=env, input=json.dumps(data), text=True,
                    capture_output=True, check=True, timeout=10,
                )
                actual = (
                    json.loads(result.stdout.lstrip('\0'))['actual']
                    if language == 'python'
                    else json.loads(result.stderr.split('QUOREM_RESULT:', 1)[1])
                )
                self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
