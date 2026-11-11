import datetime
import collections
import contextlib
import importlib
import io
import json
import math
import sys
import traceback
from pathlib import Path
import quorem_types
from quorem_types import ListNode, TreeNode, NaryTreeNode

MAX_ELEMENTS = 10000
MAX_DEPTH = 100
MAX_OUTPUT = 65536

class InvalidOutput(Exception):
    pass

class OutputLimit(Exception):
    pass

class Capture(io.TextIOBase):
    def __init__(self):
        self.size = 0
        self.parts = []
    def write(self, text):
        self.size += len(text.encode('utf-8'))
        if self.size > MAX_OUTPUT:
            raise OutputLimit()
        self.parts.append(text)
        return len(text)
    def flush(self):
        pass

def node_type(kind):
    name, separator, payload = kind.partition('<')
    if name in ('ListNode', 'TreeNode', 'NaryTreeNode'):
        return name, payload[:-1] if separator else 'int'
    return None, None

def decode(kind, value):
    kind = kind.replace("array<", "list<")
    if kind.startswith('optional<'):
        return None if value is None else decode(kind[9:-1], value)
    if kind.startswith('list<'):
        return [decode(kind[5:-1], v) for v in value]
    if kind == 'long':
        return int(value)
    if kind == 'datetime':
        return datetime.datetime.fromisoformat(value)
    node_kind, payload = node_type(kind)
    if node_kind == 'ListNode':
        dummy = ListNode()
        tail = dummy
        for item in value or []:
            tail.next = ListNode(decode(payload, item))
            tail = tail.next
        return dummy.next
    if node_kind == 'NaryTreeNode':
        if not value or value[0] is None:
            return None
        root = NaryTreeNode(decode(payload, value[0]))
        parents = [root]
        parent = 0
        for item in value[2:]:
            if item is None:
                parent += 1
            else:
                child = NaryTreeNode(decode(payload, item))
                parents[parent].children.append(child)
                parents.append(child)
        return root
    if node_kind == 'TreeNode':
        if not value:
            return None
        root = TreeNode(decode(payload, value[0]))
        parents = collections.deque([root])
        index = 1
        while parents and index < len(value):
            parent = parents.popleft()
            for side in ('left', 'right'):
                if index < len(value):
                    if value[index] is not None:
                        node = TreeNode(decode(payload, value[index]))
                        setattr(parent, side, node)
                        parents.append(node)
                    index += 1
        return root
    return value

def encode(kind, value, depth=0, count=None, seen=None):
    kind = kind.replace("array<", "list<")
    count = [0] if count is None else count
    seen = set() if seen is None else seen
    if depth > 0:
        count[0] += 1
    if count[0] > MAX_ELEMENTS or depth > MAX_DEPTH:
        raise InvalidOutput()
    if kind == 'void':
        return None
    if kind.startswith('optional<'):
        return None if value is None else encode(kind[9:-1], value, depth+1, count, seen)
    if kind.startswith('list<'):
        if not isinstance(value, list):
            raise InvalidOutput()
        if id(value) in seen:
            raise InvalidOutput()
        seen.add(id(value))
        return [encode(kind[5:-1], v, depth+1, count, seen) for v in value]
    node_kind, payload = node_type(kind)
    if node_kind:
        if value is None:
            return None
        if node_kind == 'NaryTreeNode':
            return encode_nary(payload, value, depth, count, seen)
        result = []
        queue = collections.deque([value])
        while queue:
            node = queue.popleft()
            if node is None:
                result.append(None)
                continue
            expected = ListNode if node_kind == 'ListNode' else TreeNode
            if not isinstance(node, expected) or id(node) in seen:
                raise InvalidOutput()
            seen.add(id(node))
            result.append(encode(payload, node.val, depth+1, count, seen))
            if node_kind == 'ListNode':
                if node.next is not None:
                    queue.append(node.next)
            else:
                queue.extend((node.left, node.right))
            if len(result) > MAX_ELEMENTS or len(queue) > MAX_ELEMENTS:
                raise InvalidOutput()
        if node_kind == 'TreeNode':
            while result and result[-1] is None:
                result.pop()
        return result or None
    if kind == 'datetime':
        if not isinstance(value, datetime.datetime) or value.tzinfo is not None or value.microsecond != 0:
            raise InvalidOutput()
        try:
            return value.isoformat(timespec='seconds')
        except (OverflowError, ValueError):
            raise InvalidOutput()
    if kind == 'long':
        if type(value) is not int or not -(2**63) <= value < 2**63:
            raise InvalidOutput()
        return str(value)
    if kind == 'int':
        if type(value) is not int or not -(2**31) <= value < 2**31:
            raise InvalidOutput()
    elif kind == 'float':
        if type(value) not in (int, float) or not math.isfinite(value):
            raise InvalidOutput()
    elif kind == 'bool':
        if type(value) is not bool:
            raise InvalidOutput()
    elif kind == 'str':
        if not isinstance(value, str):
            raise InvalidOutput()
    else:
        raise InvalidOutput()
    return value

def encode_nary(payload, root, depth, count, seen):
    def payload_of(node):
        if not isinstance(node, NaryTreeNode) or id(node) in seen:
            raise InvalidOutput()
        seen.add(id(node))
        return encode(payload, node.val, depth + 1, count, seen)

    result = [payload_of(root)]
    parents = [root]
    separators = 0
    for parent in parents:
        separators += 1
        if not isinstance(parent.children, list):
            raise InvalidOutput()
        if not parent.children:
            continue
        if len(result) + separators + len(parent.children) > MAX_ELEMENTS:
            raise InvalidOutput()
        result.extend([None] * separators)
        separators = 0
        for child in parent.children:
            result.append(payload_of(child))
            parents.append(child)
    return result


def original_nodes(root):
    if root is None:
        return []
    nodes = [root]
    for node in nodes:
        if isinstance(node, ListNode):
            children = [node.next]
        elif isinstance(node, TreeNode):
            children = [node.left, node.right]
        else:
            children = node.children
        nodes.extend(child for child in children if child is not None)
    return nodes


def invoke(solution, signature, raw):
    types = [parameter['type'] for parameter in signature['parameters']]
    args = [decode(kind, item.get('values') if isinstance(item, dict) else item)
            for kind, item in zip(types, raw)]
    references = signature.get('nodeReferences') == 'return' or any(isinstance(item, dict) for item in raw)
    if references:
        seeds = [original_nodes(arg) if node_type(kind)[0] else [] for kind, arg in zip(types, args)]
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            if 'ref' in item:
                argument, node = item['ref']
                args[index] = seeds[argument][node]
            else:
                argument, node = item['tail']
                seeds[index][-1].next = seeds[argument][node]
    result = getattr(solution, signature['methodName'])(*args)
    if signature.get('nodeReferences') != 'return':
        return encode(signature['returnType'], result)
    if result is None:
        return None
    for argument, nodes in enumerate(seeds):
        if types[argument] == signature['returnType']:
            for index, node in enumerate(nodes):
                if result is node:
                    return {'ref': [argument, index]}
    raise InvalidOutput()


def solution_imports(request):
    if request.get('automaticImports') is True:
        modules = json.loads(Path(quorem_types.__file__).with_name('automatic_imports.json').read_text())['python']
        return {name: importlib.import_module(name) for name in modules}
    signatures = [request.get('signature'), *request.get('methods', {}).values()]
    for signature in signatures:
        if signature and any(
            'datetime' in kind.replace('>', '').split('<')
            for kind in [signature['returnType'], *(p['type'] for p in signature['parameters'])]
        ):
            return {'datetime': datetime}
    return {}


def main():
    # Signal process readiness before contestant execution; Docker startup has its own deadline.
    sys.__stdout__.write('\0')
    sys.__stdout__.flush()
    request = json.loads(sys.stdin.buffer.read(3 * 1024 * 1024))
    out, err = Capture(), Capture()
    result = {}
    try:
        code = compile(request['source'], '<solution>', 'exec')
        namespace = {'ListNode': ListNode, 'TreeNode': TreeNode, 'NaryTreeNode': NaryTreeNode, '__name__': '__solution__'}
        namespace.update(solution_imports(request))
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(code, namespace)
            signature = request['signature']
            solution = namespace['Solution']()
            if request.get('calls'):
                result['actual'] = [
                    invoke(solution, request['methods'][call['methodName']], call['args'])
                    for call in request['calls']
                ]
            else:
                result['actual'] = invoke(solution, signature, request['args'])
        encoded = json.dumps(result['actual'], ensure_ascii=False, allow_nan=False).encode()
        if len(encoded) > MAX_OUTPUT:
            raise OutputLimit()
        result['status'] = 'executed'
    except SyntaxError as error:
        result = {'status': 'syntax_error', 'line': error.lineno or 0}
    except MemoryError:
        result = {'status': 'memory_limit'}
    except OutputLimit:
        result = {'status': 'output_limit'}
    except InvalidOutput:
        result = {'status': 'invalid_output'}
    except BaseException as error:
        result = {'status': 'runtime_error'}
        trace = error.__traceback__
        while trace and trace.tb_frame.f_code.co_filename != '<solution>':
            trace = trace.tb_next
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                traceback.print_exception(type(error), error, trace, file=err)
        except OutputLimit:
            result = {'status': 'output_limit'}
        except MemoryError:
            result = {'status': 'memory_limit'}
        except BaseException:
            pass
        if out.size > MAX_OUTPUT or err.size > MAX_OUTPUT:
            result = {'status': 'output_limit'}
    result['stdout'] = ''.join(out.parts)
    result['stderr'] = ''.join(err.parts)
    sys.__stdout__.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
    sys.__stdout__.flush()

if __name__ == '__main__':
    main()
