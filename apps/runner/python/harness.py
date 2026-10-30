import datetime
import collections
import contextlib
import io
import json
import math
import sys
import traceback
from quorem_types import ListNode, TreeNode

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

def decode(kind, value):
    kind = kind.replace("array<", "list<")
    if kind.startswith('optional<'):
        return None if value is None else decode(kind[9:-1], value)
    if kind.startswith('list<'):
        return [decode(kind[5:-1], v) for v in value]
    if kind == 'datetime':
        return datetime.datetime.fromisoformat(value)
    if kind == 'ListNode':
        dummy = ListNode()
        tail = dummy
        for item in value or []:
            tail.next = ListNode(item)
            tail = tail.next
        return dummy.next
    if kind == 'TreeNode':
        if not value:
            return None
        root = TreeNode(value[0])
        parents = collections.deque([root])
        index = 1
        while parents and index < len(value):
            parent = parents.popleft()
            for side in ('left', 'right'):
                if index < len(value):
                    if value[index] is not None:
                        node = TreeNode(value[index])
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
    if kind in ('ListNode', 'TreeNode'):
        if value is None:
            return None
        result = []
        queue = collections.deque([value])
        while queue:
            node = queue.popleft()
            if node is None:
                result.append(None)
                continue
            expected = ListNode if kind == 'ListNode' else TreeNode
            if not isinstance(node, expected) or id(node) in seen:
                raise InvalidOutput()
            seen.add(id(node))
            result.append(encode('int', node.val, depth+1, count, seen))
            if kind == 'ListNode':
                if node.next is not None:
                    queue.append(node.next)
            else:
                queue.extend((node.left, node.right))
            if len(result) > MAX_ELEMENTS or len(queue) > MAX_ELEMENTS:
                raise InvalidOutput()
        if kind == 'TreeNode':
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

def main():
    # Signal process readiness before contestant execution; Docker startup has its own deadline.
    sys.__stdout__.write('\0')
    sys.__stdout__.flush()
    request = json.loads(sys.stdin.buffer.read(3 * 1024 * 1024))
    out, err = Capture(), Capture()
    result = {}
    try:
        code = compile(request['source'], '<solution>', 'exec')
        namespace = {'ListNode': ListNode, 'TreeNode': TreeNode, '__name__': '__solution__'}
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(code, namespace)
            signature = request['signature']
            solution = namespace['Solution']()
            if request.get('calls'):
                values = []
                for call in request['calls']:
                    method = request['methods'][call['methodName']]
                    args = [decode(p['type'], v) for p, v in zip(method['parameters'], call['args'])]
                    values.append(encode(method['returnType'], getattr(solution, call['methodName'])(*args)))
                result['actual'] = values
            else:
                args = [decode(p['type'], v) for p, v in zip(signature['parameters'], request['args'])]
                value = getattr(solution, signature['methodName'])(*args)
                result['actual'] = encode(signature['returnType'], value)
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
