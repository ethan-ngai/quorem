"""Convert public LeetCode HTML to Quorem's inline Markdown and examples."""

from html.parser import HTMLParser
import re


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []


class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in ('br', 'hr', 'img', 'input', 'meta', 'link'):
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data.replace('\xa0', ' '))


def render(node, in_code=False, plain=False):
    if isinstance(node, str):
        return node
    tag = node.tag
    content = ''.join(render(child, in_code or tag == 'code', plain) for child in node.children)
    if tag == 'sup':
        return '^' + content.strip()
    if tag == 'sub':
        return '_' + content.strip()
    if tag == 'u' and not plain:
        return '**' + content.replace('*', r'\*') + '**'
    if tag == 'code' and not plain:
        # Nested code tags are formatting artifacts; keep one valid delimiter.
        content = content.strip()
        ticks = '`' * (max((len(m.group()) for m in re.finditer(r'`+', content)), default=0) + 1)
        return ticks + content + ticks if content else ''
    if tag in ('strong', 'b', 'em', 'i') and content.strip() and not in_code and not plain:
        mark = '**' if tag in ('strong', 'b') else '*'
        # Keep spaces outside delimiters for CommonMark.
        return content[:len(content) - len(content.lstrip())] + mark + content.strip() + mark + content[len(content.rstrip()):]
    if tag == 'br':
        return '\n'
    if tag == 'img':
        return f"[{node.attrs.get('alt') or 'Image'}]({node.attrs.get('src', '')})"
    if tag == 'li':
        return '- ' + content.strip() + '\n'
    if tag in ('p', 'div', 'pre', 'ul', 'ol', 'table', 'tr'):
        return content.strip() + '\n\n'
    if tag in ('td', 'th'):
        return content.strip() + ' | '
    return content



def contains_tag(node, tag):
    return node.tag == tag or any(contains_tag(child, tag) for child in node.children if isinstance(child, Node))

def clean(text):
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def format_question(content, html, parse_case=None):
    """Return formatted content or raise if every example cannot be matched."""
    doc = Document()
    doc.feed(html)
    nodes = doc.root.children
    sections = []
    for i, node in enumerate(nodes):
        if isinstance(node, str):
            continue
        text = clean(render(node))
        if re.fullmatch(r'\*\*Example\s+\d+:?\*\*', text, re.I):
            sections.append((i, 'example'))
        elif re.fullmatch(r'\*\*Constraints:?\*\*', text, re.I):
            sections.append((i, 'constraints'))
    examples = [i for i, kind in sections if kind == 'example']
    if (not examples or len(examples) > 20 or (not parse_case and len(examples) != len(content['problem']['examples']))
            or not any(kind == 'constraints' and i > examples[-1] for i, kind in sections)):
        raise ValueError('HTML examples do not match parsed examples')
    # A section without an input/output marker cannot be safely removed.
    formatted_examples = []
    original_index = 0
    boundaries = [i for i, _ in sections] + [len(nodes)]
    for index, start in enumerate(examples):
        end = min(i for i in boundaries if i > start)
        text = clean(''.join(render(node) for node in nodes[start + 1:end]))
        if not re.search(r'(?:\*\*)?Input:(?:\*\*)?', text, re.I) or not re.search(r'(?:\*\*)?Output:(?:\*\*)?', text, re.I):
            raise ValueError('HTML example is missing input or output')
        if parse_case:
            plain = clean(''.join(render(node, plain=True) for node in nodes[start + 1:end]))
            values = re.search(r'(?ms)^Input:\s*(.*?)\s*^Output:\s*(.*?)(?=\s*^Explanation:|\Z)', plain)
            if not values:
                raise ValueError('HTML example cannot be verified')
            try:
                parsed = parse_case({'input': values.group(1).strip(), 'output': values.group(2).strip()}, content['problem']['signature']['parameters'])
            except (SyntaxError, ValueError, TypeError, KeyError, RecursionError) as error:
                raise ValueError('HTML example cannot be verified') from error
            originals = content['problem']['examples']
            if original_index < len(originals) and parsed['args'] == originals[original_index]['args'] and parsed['expected'] == originals[original_index]['expected']:
                example = dict(originals[original_index])
                original_index += 1
            else:
                example = parsed
        else:
            example = dict(content['problem']['examples'][index])
        marker = re.search(r'(?:\*\*)?Explanation:(?:\*\*)?', text, re.I)
        explanation = clean(text[marker.end():]) if marker else ''
        if any(isinstance(node, Node) and contains_tag(node, 'u') for node in nodes[start + 1:end]):
            explanation = re.sub(r'\bunderlined\b', 'bolded', explanation, flags=re.I)
        before_input = text[:re.search(r'(?:\*\*)?Input:(?:\*\*)?', text, re.I).start()]
        images = re.findall(r'\[[^\]]*\]\([^\)]+\)', before_input)
        if clean(re.sub(r'\[[^\]]*\]\([^\)]+\)', '', before_input)):
            raise ValueError('unrecognised text before example input')
        if images:
            explanation = clean(' '.join(images) + '\n\n' + explanation)
        if len(explanation.encode()) > 8192:
            raise ValueError('example explanation too long')
        if explanation:
            example['explanation'] = explanation
        formatted_examples.append(example)
    if parse_case and original_index != len(content['problem']['examples']):
        raise ValueError('HTML example changed since staging')
    removed = set()
    for start in examples:
        end = min(i for i in boundaries if i > start)
        removed.update(range(start, end))
    statement = clean(''.join(render(node) for i, node in enumerate(nodes) if i not in removed))
    if not statement or len(statement.encode()) > 65536:
        raise ValueError('invalid formatted statement')
    result = dict(content)
    problem = dict(content['problem'])
    problem['statementMarkdown'] = statement
    problem['examples'] = formatted_examples
    result['problem'] = problem
    return result
