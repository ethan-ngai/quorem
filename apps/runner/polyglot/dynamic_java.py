"""Input-independent Java wrapper; each process reads only its current case."""
import json

PARSER = r'''
static class Json {
 final String s; int i;
 Json(String value){s=value;}
 void ws(){while(i<s.length()&&Character.isWhitespace(s.charAt(i)))i++;}
 char take(){if(i>=s.length())throw new IllegalArgumentException();return s.charAt(i++);}
 String string(){if(take()!='"')throw new IllegalArgumentException();StringBuilder b=new StringBuilder();for(;;){char c=take();if(c=='"')return b.toString();if(c=='\\'){c=take();switch(c){case '"':case '\\':case '/':b.append(c);break;case 'b':b.append('\b');break;case 'f':b.append('\f');break;case 'n':b.append('\n');break;case 'r':b.append('\r');break;case 't':b.append('\t');break;case 'u':b.append((char)Integer.parseInt(s.substring(i,i+4),16));i+=4;break;default:throw new IllegalArgumentException();}}else b.append(c);}}
 Object value(int depth){if(depth>110)throw new IllegalArgumentException();ws();char c=s.charAt(i);if(c=='"')return string();if(c=='['){i++;java.util.ArrayList<Object>a=new java.util.ArrayList<>();ws();if(s.charAt(i)==']'){i++;return a;}for(;;){a.add(value(depth+1));ws();c=take();if(c==']')return a;if(c!=',')throw new IllegalArgumentException();}}
 if(c=='{'){i++;java.util.Map<String,Object>m=new java.util.HashMap<>();ws();if(s.charAt(i)=='}'){i++;return m;}for(;;){ws();String k=string();ws();if(take()!=':')throw new IllegalArgumentException();m.put(k,value(depth+1));ws();c=take();if(c=='}')return m;if(c!=',')throw new IllegalArgumentException();}}
 if(s.startsWith("null",i)){i+=4;return null;}if(s.startsWith("true",i)){i+=4;return true;}if(s.startsWith("false",i)){i+=5;return false;}
 int start=i;while(i<s.length()&&"-+0123456789.eE".indexOf(s.charAt(i))>=0)i++;String n=s.substring(start,i);if(n.indexOf('.')>=0||n.indexOf('e')>=0||n.indexOf('E')>=0)return Double.valueOf(n);return Integer.valueOf(n);}
}
static Object decodeTypedNode(String type, Object value) {
    if (value == null) return null;
    java.util.List<?> values = (java.util.List<?>) value;
    String payload = type.substring(9, type.length() - 1);
    if (type.startsWith("ListNode<")) {
        TypedListNode<Object> next = null;
        for (int i = values.size() - 1; i >= 0; i--)
            next = new TypedListNode<>(decode(payload, values.get(i)), next);
        return next;
    }
    if (values.isEmpty() || values.get(0) == null) return null;
    TypedTreeNode<Object> root = new TypedTreeNode<>(decode(payload, values.get(0)));
    java.util.ArrayList<TypedTreeNode<Object>> queue = new java.util.ArrayList<>();
    queue.add(root);
    for (int i = 1, parent = 0; i < values.size(); parent++) {
        TypedTreeNode<Object> node = queue.get(parent);
        Object left = values.get(i++);
        if (left != null) {
            node.left = new TypedTreeNode<>(decode(payload, left));
            queue.add(node.left);
        }
        if (i < values.size()) {
            Object right = values.get(i++);
            if (right != null) {
                node.right = new TypedTreeNode<>(decode(payload, right));
                queue.add(node.right);
            }
        }
    }
    return root;
}
static Object decodeNary(String payload, Object value) {
    if (value == null) return null;
    java.util.List<?> values = (java.util.List<?>) value;
    if (values.isEmpty() || values.get(0) == null) return null;
    NaryTreeNode<Object> root = new NaryTreeNode<>(decode(payload, values.get(0)));
    java.util.ArrayList<NaryTreeNode<Object>> parents = new java.util.ArrayList<>();
    parents.add(root);
    for (int i = 2, parent = 0; i < values.size(); i++) {
        Object item = values.get(i);
        if (item == null) { parent++; continue; }
        NaryTreeNode<Object> child = new NaryTreeNode<>(decode(payload, item));
        parents.get(parent).children.add(child);
        parents.add(child);
    }
    return root;
}
static java.util.ArrayList<Object> originalNodes(Object root) {
    java.util.ArrayList<Object> nodes = new java.util.ArrayList<>();
    addNode(nodes, root);
    for (int i = 0; i < nodes.size(); i++) {
        Object node = nodes.get(i);
        if (node instanceof ListNode list) addNode(nodes, list.next);
        else if (node instanceof TypedListNode<?> list) addNode(nodes, list.next);
        else if (node instanceof TreeNode tree) { addNode(nodes, tree.left); addNode(nodes, tree.right); }
        else if (node instanceof TypedTreeNode<?> tree) { addNode(nodes, tree.left); addNode(nodes, tree.right); }
        else if (node instanceof NaryTreeNode<?> tree) nodes.addAll(tree.children);
    }
    return nodes;
}
static void addNode(java.util.ArrayList<Object> nodes, Object node) {
    if (node != null) nodes.add(node);
}
static String invokeCase(Object solution, String name, String[] types, java.util.List<Object> raw,
                         String returnType, boolean reference) throws Exception {
    Object[] args = new Object[types.length];
    boolean needsSeeds = reference;
    for (int i = 0; i < args.length; i++) {
        Object input = raw.get(i);
        if (input instanceof java.util.Map<?,?> record) { input = record.get("values"); needsSeeds = true; }
        args[i] = decode(types[i], input);
    }
    java.util.ArrayList<java.util.ArrayList<Object>> seeds = new java.util.ArrayList<>();
    if (needsSeeds) {
        for (int i = 0; i < args.length; i++)
            seeds.add(originalNodes(types[i].matches("(ListNode|TreeNode|NaryTreeNode)(<.*>)?") ? args[i] : null));
        for (int i = 0; i < args.length; i++) {
            if (!(raw.get(i) instanceof java.util.Map<?,?> record)) continue;
            boolean alias = record.containsKey("ref");
            java.util.List<?> ref = (java.util.List<?>) record.get(alias ? "ref" : "tail");
            Object target = seeds.get((Integer) ref.get(0)).get((Integer) ref.get(1));
            if (alias) args[i] = target;
            else {
                Object last = seeds.get(i).get(seeds.get(i).size() - 1);
                if (last instanceof ListNode list) list.next = (ListNode) target;
                else ((TypedListNode<Object>) last).next = (TypedListNode<Object>) target;
            }
        }
    }
    Object value = invoke(solution, name, args);
    if (returnType.equals("void")) return "null";
    if (!reference) return encodeResult(returnType, value);
    if (value == null) return "null";
    for (int argument = 0; argument < args.length; argument++) {
        if (!types[argument].equals(returnType)) continue;
        java.util.ArrayList<Object> nodes = seeds.get(argument);
        for (int index = 0; index < nodes.size(); index++)
            if (nodes.get(index) == value) return "{\"ref\":[" + argument + "," + index + "]}";
    }
    System.exit(42);
    return "";
}
static Object decode(String t,Object v){
 if(t.startsWith("optional<"))return v==null?null:decode(t.substring(9,t.length()-1),v);
 if(t.startsWith("list<")||t.startsWith("array<")){java.util.List<?>xs=(java.util.List<?>)v;Object[]a=new Object[xs.size()];String inner=t.substring(t.startsWith("list<")?5:6,t.length()-1);for(int i=0;i<a.length;i++)a[i]=decode(inner,xs.get(i));return a;}
 if(t.equals("NaryTreeNode")||t.startsWith("NaryTreeNode<"))return decodeNary(t.contains("<")?t.substring(13,t.length()-1):"int",v);
 if(t.startsWith("ListNode<")||t.startsWith("TreeNode<"))return decodeTypedNode(t,v);
 if(t.equals("ListNode")){if(v==null)return null;java.util.List<?>xs=(java.util.List<?>)v;ListNode node=null;for(int i=xs.size()-1;i>=0;i--)node=new ListNode(((Number)xs.get(i)).intValue(),node);return node;}
 if(t.equals("TreeNode")){if(v==null)return null;java.util.List<?>xs=(java.util.List<?>)v;if(xs.isEmpty()||xs.get(0)==null)return null;TreeNode root=new TreeNode(((Number)xs.get(0)).intValue());java.util.ArrayList<TreeNode>q=new java.util.ArrayList<>();q.add(root);int i=1;for(int p=0;p<q.size()&&i<xs.size();p++){TreeNode n=q.get(p);Object left=xs.get(i++);if(left!=null){n.left=new TreeNode(((Number)left).intValue());q.add(n.left);}if(i<xs.size()){Object right=xs.get(i++);if(right!=null){n.right=new TreeNode(((Number)right).intValue());q.add(n.right);}}}return root;}
 if(t.equals("long"))return Long.valueOf((String)v);
 if(t.equals("datetime"))return java.time.LocalDateTime.parse((String)v);
 if(t.equals("float"))return ((Number)v).doubleValue();if(t.equals("int"))return ((Number)v).intValue();return v;
}
'''

def source(r, h):
    signatures = dict(r.get('methods') or {})
    signatures[r['signature']['methodName']] = r['signature']
    branches = []
    for name, sig in signatures.items():
        types = ','.join(json.dumps(p['type']) for p in sig['parameters'])
        reference = json.dumps(sig.get('nodeReferences') == 'return')
        branches.append(f'case {json.dumps(name)}:return invokeCase(solution,name,new String[]{{{types}}},args,{json.dumps(sig["returnType"])},{reference});')
    call = 'static String call(Object solution,String name,java.util.List<Object>args)throws Exception{switch(name){'+''.join(branches)+'default:throw new IllegalArgumentException();}}'
    # Catch codec failures after invocation; contestant exceptions retain runtime_error.
    call += 'static String encodeResult(String type,Object value){try{count=0;seen.clear();return encode(type,value,0);}catch(RuntimeException e){System.exit(42);return "";}}'
    main = '''public static void main(String[] argv)throws Exception {
 java.util.Map<String,Object>request=(java.util.Map<String,Object>)new Json(new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).value(0);
 Object solution=new CLASS();java.util.List<?>calls=(java.util.List<?>)request.get("calls");String output;
 if(calls!=null&&!calls.isEmpty()){java.util.ArrayList<String>results=new java.util.ArrayList<>();for(Object raw:calls){java.util.Map<String,Object>c=(java.util.Map<String,Object>)raw;results.add(call(solution,(String)c.get("methodName"),(java.util.List<Object>)c.get("args")));}output="["+String.join(",",results)+"]";}
 else output=call(solution,METHOD,(java.util.List<Object>)request.get("args"));
 System.err.print("\\nQUOREM_RESULT:"+output);
}'''.replace('CLASS',r['signature']['className']).replace('METHOD',json.dumps(r['signature']['methodName']))
    return 'import java.util.*;\nimport java.time.LocalDateTime;\n'+h['JAVA_TYPES']+r['source']+'\nclass Main {\n'+h['JAVA_ENCODER']+PARSER+call+main+'\n}'
