"""Input-independent TypeScript wrapper with typed case decoding."""
import json

DECODER = '''
function decode(t:string,v:any):any {
 if(t.startsWith('optional<'))return v===null?null:decode(t.slice(9,-1),v);
 if(t.startsWith('array<'))t='list<'+t.slice(6);
 if(t.startsWith('list<'))return v.map((x:any)=>decode(t.slice(5,-1),x));
 if(t==='long')return BigInt(v);
 if(t==='datetime')return new Date(v+'Z');
 const payload=t.includes('<')?t.slice(t.indexOf('<')+1,-1):'int';
 if(t==='NaryTreeNode'||t.startsWith('NaryTreeNode<')){
  if(!v?.length||v[0]===null)return null;
  const root=new NaryTreeNode(decode(payload,v[0])), parents=[root];
  for(let i=2,parent=0;i<v.length;i++){
   if(v[i]===null){parent++;continue;}
   const child=new NaryTreeNode(decode(payload,v[i]));
   parents[parent]!.children.push(child);parents.push(child);
  }
  return root;
 }
 if(t==='ListNode'||t.startsWith('ListNode<')){let next:ListNode<any>|null=null;for(let i=(v?.length??0)-1;i>=0;i--)next=new ListNode(decode(payload,v[i]),next);return next;}
 if(t==='TreeNode'||t.startsWith('TreeNode<')){if(!v?.length||v[0]===null)return null;const root=new TreeNode(decode(payload,v[0]));const q=[root];let i=1;for(let p=0;p<q.length&&i<v.length;p++){const n=q[p]!;const left=v[i++];if(left!==null){n.left=new TreeNode(decode(payload,left));q.push(n.left);}if(i<v.length){const right=v[i++];if(right!==null){n.right=new TreeNode(decode(payload,right));q.push(n.right);}}}return root;}
 return v;
}
function invoke(types:string[], raw:any[], fn:(...args:any[])=>any, returnType:string, reference:boolean):any {
 const isRecord=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const args=types.map((type,i)=>decode(type,isRecord(raw[i])?raw[i].values??null:raw[i]));
 const seeds:any[][]=[];
 if(reference||raw.some(isRecord)){
  types.forEach((type,i)=>{
   const root=args[i];
   const nodes:any[]=root!==null&&/^(ListNode|TreeNode|NaryTreeNode)(<|$)/.test(type)?[root]:[];
   for(const node of nodes){
    const children=node instanceof ListNode?[node.next]:node instanceof TreeNode?[node.left,node.right]:node.children;
    for(const child of children)if(child!==null)nodes.push(child);
   }
   seeds.push(nodes);
  });
  raw.forEach((item,i)=>{
   if(!isRecord(item))return;
   const [argument,index]=item.ref??item.tail;
   const target=seeds[argument]![index];
   if(item.ref)args[i]=target;
   else seeds[i]!.at(-1).next=target;
  });
 }
 const value=fn(...args);
 if(!reference)return encode(returnType,value);
 if(value===null)return null;
 for(let argument=0;argument<types.length;argument++){
  if(types[argument]!==returnType)continue;
  const index=seeds[argument]!.indexOf(value);
  if(index>=0)return {ref:[argument,index]};
 }
 throw Error('invalid_output');
}
'''

def source(r,h):
    signatures=dict(r.get('methods') or {})
    signatures[r['signature']['methodName']]=r['signature']
    branches=[]
    for name,sig in signatures.items():
        types=json.dumps([p['type'] for p in sig['parameters']])
        reference=json.dumps(sig.get('nodeReferences') == 'return')
        arguments=','.join(f'values[{i}]' for i in range(len(sig['parameters'])))
        branches.append(f'case {json.dumps(name)}:return invoke({types},args,(...values)=>solution.{name}({arguments}),{json.dumps(sig["returnType"])},{reference});')
    body='''
const request=JSON.parse(process.getBuiltinModule('fs').readFileSync(0,'utf8'));
const solution=new CLASS();
function call(name:string,args:any[]):any{count=0;seen.clear();switch(name){BRANCHES default:throw Error('invalid_input');}}
try{const result=request.calls?.length?request.calls.map((c:any)=>call(c.methodName,c.args)):call(METHOD,request.args);process.stderr.write('\\nQUOREM_RESULT:'+JSON.stringify(result));}
catch(e){if(e instanceof Error&&e.message==='invalid_output')process.exit(42);throw e;}
'''.replace('CLASS',r['signature']['className']).replace('BRANCHES',''.join(branches)).replace('METHOD',json.dumps(r['signature']['methodName']))
    return 'declare const process:any;\n'+h['TS_TYPES']+r['source']+'\n'+h['TS_ENCODER']+DECODER+body
