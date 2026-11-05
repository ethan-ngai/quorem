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

    def nary(self, root):
        root.children[0].children[0].val += 1
        return root

    def cycle(self, head):
        return head.next.next.next.next

    def intersection(self, a, b):
        assert a.next is b.next
        return b.next

    def ancestor(self, root, p):
        assert root.right is p
        return p
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

    NaryTreeNode<Integer> nary(NaryTreeNode<Integer> root) {
        root.children.get(0).children.get(0).val++;
        return root;
    }

    ListNode cycle(ListNode head) {
        return head.next.next.next.next;
    }

    TypedListNode<Integer> intersection(TypedListNode<Integer> a, TypedListNode<Integer> b) {
        if (a.next != b.next) throw new AssertionError();
        return b.next;
    }

    TreeNode ancestor(TreeNode root, TreeNode p) {
        if (root.right != p) throw new AssertionError();
        return p;
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

    nary(root: NaryTreeNode<number>) {
        root.children[0]!.children[0]!.val++;
        return root;
    }

    cycle(head: ListNode) {
        return head.next!.next!.next!.next;
    }

    intersection(a: ListNode<number>, b: ListNode<number>) {
        if (a.next !== b.next) throw Error();
        return b.next;
    }

    ancestor(root: TreeNode, p: TreeNode) {
        if (root.right !== p) throw Error();
        return p;
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

let nary (root : int nary_tree_node option) =
  let node = List.hd (List.hd (Option.get root).children).children in
  node.value <- node.value + 1;
  root

let cycle (head : list_node option) =
  let next n = (Option.get n).next in
  next (next (next (next head)))

let intersection (a : int typed_list_node option) (b : int typed_list_node option) =
  let shared = (Option.get b).next in
  assert (Option.get (Option.get a).next == Option.get shared);
  shared

let ancestor (root : tree_node option) (p : tree_node option) =
  assert (Option.get (Option.get root).right == Option.get p);
  p
''',
}


class GenericNodesTest(unittest.TestCase):
    def test_node_round_trips_and_case_local_identity(self):
        tree = signature('tree', 'TreeNode<str>', 'TreeNode', result='TreeNode<str>')
        linked = signature('linked', 'ListNode<long>', result='ListNode<long>')
        nary = signature('nary', 'NaryTreeNode<int>', result='NaryTreeNode<int>')
        cycle = signature('cycle', 'ListNode', result='ListNode')
        intersection = signature('intersection', 'ListNode<int>', 'ListNode<int>', result='ListNode<int>')
        ancestor = signature('ancestor', 'TreeNode', 'TreeNode', result='TreeNode')
        for method in (cycle, intersection, ancestor):
            method['nodeReferences'] = 'return'
        methods = {method['methodName']: method for method in (tree, linked, nary, cycle, intersection, ancestor)}
        calls = [
            {'methodName': 'tree', 'args': [['a', None, 'b'], [2]]},
            {'methodName': 'linked', 'args': [['9007199254740992', '-9223372036854775808']]},
            {'methodName': 'nary', 'args': [[1, None, 3, 2, 4, None, 5, 6, None]]},
            {'methodName': 'cycle', 'args': [{'values': [3, 2, 2, -4], 'tail': [0, 2]}]},
            {'methodName': 'intersection', 'args': [[4, 8, 5], {'values': [6], 'tail': [0, 1]}]},
            {'methodName': 'ancestor', 'args': [[1, None, 2, 2], {'ref': [0, 1]}]},
            {'methodName': 'cycle', 'args': [[3, 2, 2, -4]]},
        ]
        expected = [
            ['a', None, 'b3'], ['9007199254740993', '-9223372036854775808'],
            [1, None, 3, 2, 4, None, 6, 6], {'ref': [0, 2]}, {'ref': [0, 1]},
            {'ref': [0, 1]}, None,
        ]
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
