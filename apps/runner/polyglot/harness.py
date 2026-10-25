"""Compile and execute inside the bounded container, never on the runner host."""
import json, os, subprocess, sys

MAX_OUTPUT = 65536

def typ(kind, lang):
    if kind.startswith("array<"):
        inner=typ(kind[6:-1],lang)
        return {"java":inner+"[]","typescript":"("+inner+")[]","ocaml":"("+inner+") array"}[lang]
    if kind.startswith('optional<'):
        inner = typ(kind[9:-1], lang)
        return {'java': {'int':'Integer','double':'Double','boolean':'Boolean'}.get(inner,inner), 'typescript': inner+' | null', 'ocaml': '('+inner+') option'}[lang]
    if kind.startswith('list<'):
        inner = typ(kind[5:-1], lang)
        return {'java':inner+'[]','typescript':'('+inner+')[]','ocaml':'('+inner+') list'}[lang]
    return {'java':{'int':'int','float':'double','bool':'boolean','str':'String','ListNode':'ListNode','TreeNode':'TreeNode'},'typescript':{'int':'number','float':'number','bool':'boolean','str':'string','ListNode':'ListNode | null','TreeNode':'TreeNode | null'},'ocaml':{'int':'int','float':'float','bool':'bool','str':'string','ListNode':'list_node option','TreeNode':'tree_node option'}}[lang][kind]

def literal(kind, value, lang):
    if kind.startswith("array<"):
        if lang=="ocaml":return "[|"+";".join(literal(kind[6:-1],v,lang) for v in value)+"|]"
        return literal("list<"+kind[6:],value,lang)
    if kind.startswith('optional<'):
        if value is None: return 'None' if lang=='ocaml' else 'null'
        inner=literal(kind[9:-1],value,lang)
        return '(Some ('+inner+'))' if lang=='ocaml' else inner
    if kind.startswith('list<'):
        items=[literal(kind[5:-1],v,lang) for v in value]
        return 'new '+typ(kind,lang)+'{'+','.join(items)+'}' if lang=='java' else ('['+';'.join(items)+']' if lang=='ocaml' else '['+','.join(items)+']')
    if kind=='ListNode':
        result='None' if lang=='ocaml' else 'null'
        for v in reversed(value or []):
            result={'java':f'new ListNode({v},{result})','typescript':f'new ListNode({v},{result})','ocaml':f'Some {{value=({v}); next=({result})}}'}[lang]
        return '('+result+')'
    if kind=='TreeNode':
        nodes=[] if not value else [[v,None,None] if v is not None else None for v in value]
        if not nodes: return 'None' if lang=='ocaml' else 'null'
        parents=[nodes[0]]; i=1
        for p in parents:
            for side in (1,2):
                if i<len(nodes):
                    p[side]=nodes[i]
                    if nodes[i] is not None: parents.append(nodes[i])
                    i+=1
        def emit(n):
            if n is None: return 'None' if lang=='ocaml' else 'null'
            a,b=emit(n[1]),emit(n[2])
            return f'Some {{value=({n[0]}); left=({a}); right=({b})}}' if lang=='ocaml' else f'new TreeNode({n[0]},{a},{b})'
        return '('+emit(nodes[0])+')'
    if kind=='str':
        # JSON strings are valid Java/JS strings; OCaml byte escapes retain UTF-8.
        return '"'+''.join('\\%03d'%b for b in value.encode())+'"' if lang=='ocaml' else json.dumps(value,ensure_ascii=True)
    if kind=='bool': return 'true' if value else 'false'
    if kind=='float': return repr(float(value))
    return str(value)

JAVA_TYPES='''class ListNode { public int val; public ListNode next; public ListNode(){this(0,null);} public ListNode(int v){this(v,null);} public ListNode(int v,ListNode n){val=v;next=n;} }
class TreeNode { public int val; public TreeNode left,right; public TreeNode(){this(0,null,null);} public TreeNode(int v){this(v,null,null);} public TreeNode(int v,TreeNode l,TreeNode r){val=v;left=l;right=r;} }
'''
JAVA_ENCODER=r'''
static Object argument(Object v,java.lang.reflect.Type t,int depth){if(depth>100)throw new IllegalArgumentException();if(v==null)return null;
if(t instanceof java.lang.reflect.ParameterizedType){java.lang.reflect.ParameterizedType p=(java.lang.reflect.ParameterizedType)t;if(p.getRawType()==java.util.List.class){java.util.ArrayList<Object> out=new java.util.ArrayList<>();for(int i=0;i<java.lang.reflect.Array.getLength(v);i++)out.add(argument(java.lang.reflect.Array.get(v,i),p.getActualTypeArguments()[0],depth+1));return out;}}
if(t instanceof java.lang.reflect.GenericArrayType){java.lang.reflect.Type component=((java.lang.reflect.GenericArrayType)t).getGenericComponentType();Class<?> raw=component instanceof java.lang.reflect.ParameterizedType?(Class<?>)((java.lang.reflect.ParameterizedType)component).getRawType():(Class<?>)component;int n=java.lang.reflect.Array.getLength(v);Object out=java.lang.reflect.Array.newInstance(raw,n);for(int i=0;i<n;i++)java.lang.reflect.Array.set(out,i,argument(java.lang.reflect.Array.get(v,i),component,depth+1));return out;}
if(t instanceof Class && ((Class<?>)t).isArray()){Class<?> component=((Class<?>)t).getComponentType();int n=java.lang.reflect.Array.getLength(v);Object out=java.lang.reflect.Array.newInstance(component,n);for(int i=0;i<n;i++)java.lang.reflect.Array.set(out,i,argument(java.lang.reflect.Array.get(v,i),component,depth+1));return out;}return v;}
static Object invoke(Object target,String name,Object[] args)throws Exception{java.lang.reflect.Method selected=null;for(java.lang.reflect.Method m:target.getClass().getDeclaredMethods())if(m.getName().equals(name)&&m.getParameterCount()==args.length){selected=m;break;}if(selected==null)throw new NoSuchMethodException(name);java.lang.reflect.Type[] types=selected.getGenericParameterTypes();for(int i=0;i<args.length;i++)args[i]=argument(args[i],types[i],0);return selected.invoke(target,args);}
static java.util.IdentityHashMap<Object,Boolean> seen=new java.util.IdentityHashMap<>(); static int count=0;
static String quote(String s){StringBuilder b=new StringBuilder("\""); for(char c:s.toCharArray()){if(c=='"'||c=='\\')b.append('\\').append(c);else if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}return b.append('"').toString();}
static String encode(String t,Object v,int d){if(d>100||(d>0&&++count>10000))throw new IllegalArgumentException();
if(t.startsWith("optional<"))return v==null?"null":encode(t.substring(9,t.length()-1),v,d+1);
if(t.startsWith("list<")||t.startsWith("array<")){boolean array=t.startsWith("array<");if(v==null||(!(v instanceof java.util.List)&&!v.getClass().isArray())||(array&&!v.getClass().isArray())||seen.put(v,true)!=null)throw new IllegalArgumentException(); java.util.ArrayList<String> a=new java.util.ArrayList<>();int n=v instanceof java.util.List?((java.util.List<?>)v).size():java.lang.reflect.Array.getLength(v);for(int i=0;i<n;i++)a.add(encode(t.substring(array?6:5,t.length()-1),v instanceof java.util.List?((java.util.List<?>)v).get(i):java.lang.reflect.Array.get(v,i),d+1));return "["+String.join(",",a)+"]";}
if(t.equals("ListNode")||t.equals("TreeNode")){if(v==null)return "null";java.util.ArrayList<Object> q=new java.util.ArrayList<>();java.util.ArrayList<String>a=new java.util.ArrayList<>();q.add(v);for(int i=0;i<q.size();i++){Object n=q.get(i);if(n==null){a.add("null");continue;}if(seen.put(n,true)!=null||q.size()>10000)throw new IllegalArgumentException();if(t.equals("ListNode")){ListNode x=(ListNode)n;a.add(encode("int",x.val,d+1));if(x.next!=null)q.add(x.next);}else{TreeNode x=(TreeNode)n;a.add(encode("int",x.val,d+1));q.add(x.left);q.add(x.right);}}while(!a.isEmpty()&&a.get(a.size()-1).equals("null"))a.remove(a.size()-1);return "["+String.join(",",a)+"]";}
if(t.equals("str"))return quote((String)v);if(t.equals("int")){if(!(v instanceof Integer))throw new IllegalArgumentException();return v.toString();}if(t.equals("float")){double x=((Number)v).doubleValue();if(!Double.isFinite(x))throw new IllegalArgumentException();return Double.toString(x);}if(t.equals("bool"))return ((Boolean)v).toString();throw new IllegalArgumentException();}
'''
TS_TYPES='''class ListNode { constructor(public val=0,public next:ListNode|null=null){} }
class TreeNode { constructor(public val=0,public left:TreeNode|null=null,public right:TreeNode|null=null){} }
'''
TS_ENCODER='''let count=0; const seen=new Set<any>();
function encode(t:string,v:any,d=0):any {if(d>100||(d>0&&++count>10000))throw Error('invalid_output');
if(t.startsWith('optional<'))return v===null?null:encode(t.slice(9,-1),v,d+1);
if(t.startsWith('array<'))t='list<'+t.slice(6);
if(t.startsWith('list<')){if(!Array.isArray(v)||seen.has(v))throw Error('invalid_output');seen.add(v);return v.map(x=>encode(t.slice(5,-1),x,d+1));}
if(t==='ListNode'||t==='TreeNode'){if(v===null)return null;const q=[v],a:any[]=[];for(let i=0;i<q.length;i++){const n=q[i];if(n===null){a.push(null);continue;}if(!(n instanceof (t==='ListNode'?ListNode:TreeNode))||seen.has(n)||q.length>10000)throw Error('invalid_output');seen.add(n);a.push(encode('int',n.val,d+1));if(t==='ListNode'){if((n as any).next!==null)q.push((n as any).next);}else q.push((n as any).left,(n as any).right);}while(a.at(-1)===null)a.pop();return a.length?a:null;}
if(t==='void')return null;
if(t==='int'&&(!Number.isInteger(v)||v< -2147483648||v>2147483647)||t==='float'&&(typeof v!=='number'||!Number.isFinite(v))||t==='str'&&typeof v!=='string'||t==='bool'&&typeof v!=='boolean')throw Error('invalid_output');return v;}
'''
OCAML_TYPES='''type list_node = { mutable value:int; mutable next:list_node option }
type tree_node = { mutable value:int; mutable left:tree_node option; mutable right:tree_node option }
'''
OCAML_ENCODER=r'''
let count = ref 0
let guard d = if d > 0 then incr count; if d > 100 || !count > 10000 then failwith "invalid_output"
let quote s = let b = Buffer.create 32 in Buffer.add_char b '"'; String.iter (fun c -> match c with '"' -> Buffer.add_string b "\\\"" | '\\' -> Buffer.add_string b "\\\\" | c when Char.code c < 32 -> Buffer.add_string b (Printf.sprintf "\\u%04x" (Char.code c)) | c -> Buffer.add_char b c) s; Buffer.add_char b '"'; Buffer.contents b
let enc_int d v = guard d; if v < -2147483648 || v > 2147483647 then failwith "invalid_output"; string_of_int v
let enc_float d v = guard d; if not (Float.is_finite v) then failwith "invalid_output"; Printf.sprintf "%.17g" v
let enc_bool d v = guard d; string_of_bool v
let enc_str d v = guard d; quote v
let enc_list f d v = guard d; "[" ^ String.concat "," (List.map (f (d+1)) v) ^ "]"
let enc_optional f d v = guard d; match v with None -> "null" | Some x -> f (d+1) x
let enc_node d v = match v with None -> "null" | Some _ -> let rec loop acc n = match n with None -> "["^String.concat "," (List.rev acc)^"]" | Some (x:list_node) -> loop (enc_int (d+1) x.value::acc) x.next in loop [] v
let enc_tree d v = match v with None -> "null" | Some _ -> let rec loop acc = function [] -> List.rev acc | None::xs -> guard (d+1); loop ("null"::acc) xs | Some (x:tree_node)::xs -> loop (enc_int (d+1) x.value::acc) (xs@[x.left;x.right]) in let rec trim = function "null"::xs -> trim xs | xs -> xs in "["^String.concat "," (List.rev (trim (List.rev (loop [] [v]))))^"]"
'''
def ocaml_encoder(t):
    if t=='void': return '(fun _ () -> \"null\")'
    if t.startswith('optional<'): return '(enc_optional '+ocaml_encoder(t[9:-1])+')'
    if t.startswith('array<'): return '(fun d xs -> (enc_list '+ocaml_encoder(t[6:-1])+') d (Array.to_list xs))'
    if t.startswith('list<'): return '(enc_list '+ocaml_encoder(t[5:-1])+')'
    return {'int':'enc_int','float':'enc_float','bool':'enc_bool','str':'enc_str','ListNode':'enc_node','TreeNode':'enc_tree'}[t]

def sequence_body(r,lang):
    expressions=[]
    for call in r['calls']:
        sig=r['methods'][call['methodName']]
        args=[literal(p['type'],v,lang) for p,v in zip(sig['parameters'],call['args'])]
        method=call['methodName']; ret=sig['returnType']
        if lang=='java' and ret=='void': expressions.append('invoke(solution,'+json.dumps(method)+',new Object[]{'+','.join(args)+'});results.add(\"null\");')
        elif lang=='java': expressions.append('count=0;seen.clear();results.add(encode('+json.dumps(ret)+',invoke(solution,'+json.dumps(method)+',new Object[]{'+','.join(args)+'}),0));')
        elif lang=='typescript': expressions.append('count=0;seen.clear();results.push(encode('+json.dumps(ret)+',solution.'+method+'('+','.join(args)+')));')
        else: expressions.append('let value=Solution.'+method+' '+(' '.join('('+a+')' for a in args) if args else '()')+' in count:=0; '+ocaml_encoder(ret)+' 0 value')
    if lang=='java': return 'Solution solution=new Solution();java.util.ArrayList<String> results=new java.util.ArrayList<>();'+''.join(expressions)+'String output="["+String.join(",",results)+"]";System.err.print("\\nQUOREM_RESULT:"+output);'
    if lang=='typescript':return 'const solution=new Solution();const results:any[]=[];'+''.join(expressions)+'process.stderr.write("\\nQUOREM_RESULT:"+JSON.stringify(results));'
    # OCaml evaluates list operands in an unspecified order; explicit lets fence stateful calls.
    bindings=''.join('let result'+str(i)+' = ('+e+') in ' for i,e in enumerate(expressions))
    return bindings+'prerr_string ("\\nQUOREM_RESULT:[" ^ String.concat "," ['+';'.join('result'+str(i) for i in range(len(expressions)))+'] ^ "]")'

def prepare(r,lang):
    s=r['signature']; args=[literal(p['type'],v,lang) for p,v in zip(s['parameters'],r['args'])]; method=s['methodName']; ret=s['returnType']
    if r.get('calls'):
        body=sequence_body(r,lang)
        if lang=='java':
            source='import java.util.*;\n'+JAVA_TYPES+r['source']+'\nclass Main {\n'+JAVA_ENCODER+'\npublic static void main(String[] a)throws Exception {try{'+body+'}catch(IllegalArgumentException e){System.exit(42);}}}'
            open('/tmp/Main.java','w').write(source)
            return ['javac','-J-Xmx128m','-J-XX:ActiveProcessorCount=1','-J-XX:+UseSerialGC','-J-XX:-UsePerfData','/tmp/Main.java'], ['java','-Xmx128m','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-XX:-UsePerfData','-cp','/tmp','Main']
        if lang=='typescript':
            source=TS_TYPES+r['source']+'\n'+TS_ENCODER+'\ntry{'+body+'}catch(e){if(e instanceof Error && e.message==="invalid_output")process.exit(42);throw e;}'
            open('/tmp/main.ts','w').write('declare const process:any;\n'+source)
            return ['tsc','--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir','/tmp','/tmp/main.ts'], ['node','--max-old-space-size=128','/tmp/main.js']
        source=OCAML_TYPES+'\nmodule Solution = struct\n'+r['source']+'\nend\n'+OCAML_ENCODER+'\nlet () = try '+body+' with Failure _ -> exit 42\n'
        open('/tmp/main.ml','w').write(source)
        return ['ocamlc','-o','/tmp/main.byte','/tmp/main.ml'], ['ocamlrun','/tmp/main.byte']
    if lang=='java':
        source='import java.util.*;\n'+JAVA_TYPES+r['source']+'\nclass Main {\n'+JAVA_ENCODER+'\npublic static void main(String[] a)throws Exception { Object v=invoke(new '+s['className']+'(),'+json.dumps(method)+',new Object[]{'+','.join(args)+'}); String output;try{output=encode('+json.dumps(ret)+',v,0);}catch(Throwable e){System.err.print("invalid_output");System.exit(42);return;} System.err.print("\\nQUOREM_RESULT:"+output);}}'
        open('/tmp/Main.java','w').write(source)
        # Compiler JVM shares the PID cap with the trusted supervisor.
        return ['javac','-J-Xmx128m','-J-XX:ActiveProcessorCount=1','-J-XX:+UseSerialGC','-J-XX:-UsePerfData','/tmp/Main.java'], ['java','-Xmx128m','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-XX:-UsePerfData','-cp','/tmp','Main']
    if lang=='typescript':
        source=TS_TYPES+r['source']+'\n'+TS_ENCODER+'\ntry { const v=new '+s['className']+'().'+method+'('+','.join(args)+'); process.stderr.write("\\nQUOREM_RESULT:"+JSON.stringify(encode('+json.dumps(ret)+',v))); } catch(e) { if(e instanceof Error && e.message==="invalid_output")process.exit(42); throw e; }'
        open('/tmp/main.ts','w').write('declare const process:any;\n'+source)
        return ['tsc','--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir','/tmp','/tmp/main.ts'], ['node','--max-old-space-size=128','/tmp/main.js']
    source=OCAML_TYPES+'\nmodule Solution = struct\n'+r['source']+'\nend\n'+OCAML_ENCODER+'\nlet () = let v = Solution.'+method+' '+' '.join('('+a+')' for a in args)+' in let output = try '+ocaml_encoder(ret)+' 0 v with Failure _ -> exit 42 in prerr_string ("\\nQUOREM_RESULT:"^output)\n'
    open('/tmp/main.ml','w').write(source)
    return ['ocamlc','-o','/tmp/main.byte','/tmp/main.ml'], ['ocamlrun','/tmp/main.byte']

def run(cmd):
    # Drain to files: contestant output cannot grow the trusted supervisor's memory.
    with open('/tmp/stdout','w+b') as out, open('/tmp/stderr','w+b') as err:
        code=subprocess.call(cmd,stdout=out,stderr=err)
        sizes=[out.tell(),err.tell()]
        out.seek(0);err.seek(0)
        return code,out.read(MAX_OUTPUT+1),err.read(MAX_OUTPUT+1),max(sizes)>MAX_OUTPUT

def main():
    sys.stdout.write('\0');sys.stdout.flush()
    r=json.loads(sys.stdin.buffer.read(400000)); lang=os.environ['QUOREM_LANGUAGE']
    compile_cmd,cmd=prepare(r,lang)
    code,out,err,exceeded=run(compile_cmd)
    sys.stdout.write('\0');sys.stdout.flush()
    result={'status':'syntax_error','stderr':(out+err).decode('utf-8','replace')[:MAX_OUTPUT]} if code else None
    if result is None:
        code,out,err,exceeded=run(cmd)
        marker=b'\nQUOREM_RESULT:'
        if exceeded: result={'status':'output_limit'}
        elif code==42: result={'status':'invalid_output'}
        elif code: result={'status':'runtime_error','stdout':out.decode('utf-8','replace'),'stderr':err.decode('utf-8','replace')}
        elif marker not in err: result={'status':'invalid_output'}
        else:
            capture,encoded=err.rsplit(marker,1)
            try: result={'status':'executed','actual':json.loads(encoded),'stdout':out.decode('utf-8','replace'),'stderr':capture.decode('utf-8','replace')}
            except ValueError: result={'status':'invalid_output'}
    if exceeded:result={'status':'output_limit'}
    sys.stdout.write(json.dumps(result,ensure_ascii=False));sys.stdout.flush()
if __name__=='__main__':main()
