"""Compile and execute inside the bounded container, never on the runner host."""
import json, os, subprocess, sys
import compiled

MAX_OUTPUT = 65536

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

def run(cmd, data=None):
    # Drain to files: contestant output cannot grow the trusted supervisor's memory.
    with open('/tmp/stdout','w+b') as out, open('/tmp/stderr','w+b') as err:
        code=subprocess.run(cmd,input=data,stdout=out,stderr=err).returncode
        sizes=[out.tell(),err.tell()]
        out.seek(0);err.seek(0)
        return code,out.read(MAX_OUTPUT+1),err.read(MAX_OUTPUT+1),max(sizes)>MAX_OUTPUT

def main():
    sys.stdout.write('\0');sys.stdout.flush()
    r=json.loads(sys.stdin.buffer.read(8*1024*1024)); lang=os.environ['QUOREM_LANGUAGE']
    operation=r.get('operation')
    if operation=='execute':
        compiled.install(r['artifact'],lang)
        compile_cmd=None
        cmd=compiled.command(lang)
    elif operation in ('compile','compile-execute'):
        compiler_request={key:r[key] for key in ('source','signature','methods') if key in r}
        compile_cmd=compiled.prepare(compiler_request,lang,globals())
        cmd=compiled.command(lang) if operation=='compile-execute' else None
    else:
        raise ValueError('unsupported operation')
    code,out,err,exceeded=run(compile_cmd) if compile_cmd else (0,b'',b'',False)
    result={'status':'syntax_error','stderr':(out+err).decode('utf-8','replace')[:MAX_OUTPUT]} if code else None
    artifact=None
    if result is None and operation in ('compile','compile-execute'):
        try:artifact=compiled.collect(lang)
        except (ValueError,OSError):result={'status':'output_limit'}
        if result is None and operation=='compile':result={'status':'executed','actual':artifact}
    # Artifact preparation is trusted work, outside the contestant wall-time budget.
    sys.stdout.write('\0');sys.stdout.flush()
    if result is None:
        data=json.dumps({'args':r.get('args',[]),'calls':r.get('calls',[])},ensure_ascii=False).encode() if operation in ('execute','compile-execute') else None
        code,out,err,exceeded=run(cmd,data)
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
    if operation=='compile-execute' and artifact is not None:result['artifact']=artifact
    sys.stdout.write(json.dumps(result,ensure_ascii=False));sys.stdout.flush()
if __name__=='__main__':main()
