"""Input-independent TypeScript wrapper with typed case decoding."""
import json

DECODER = '''
function decode(t:string,v:any):any {
 if(t.startsWith('optional<'))return v===null?null:decode(t.slice(9,-1),v);
 if(t.startsWith('array<'))t='list<'+t.slice(6);
 if(t.startsWith('list<'))return v.map((x:any)=>decode(t.slice(5,-1),x));
 if(t==='datetime')return new Date(v+'Z');
 if(t==='ListNode'){let next:ListNode|null=null;for(let i=(v?.length??0)-1;i>=0;i--)next=new ListNode(v[i],next);return next;}
 if(t==='TreeNode'){if(!v?.length||v[0]===null)return null;const root=new TreeNode(v[0]);const q=[root];let i=1;for(let p=0;p<q.length&&i<v.length;p++){const n=q[p]!;const left=v[i++];if(left!==null){n.left=new TreeNode(left);q.push(n.left);}if(i<v.length){const right=v[i++];if(right!==null){n.right=new TreeNode(right);q.push(n.right);}}}return root;}
 return v;
}
'''

def source(r,h):
    signatures=dict(r.get('methods') or {})
    signatures[r['signature']['methodName']]=r['signature']
    branches=[]
    for name,sig in signatures.items():
        args=','.join('decode('+json.dumps(p['type'])+',args['+str(i)+'])' for i,p in enumerate(sig['parameters']))
        branches.append('case '+json.dumps(name)+':return encode('+json.dumps(sig['returnType'])+',solution.'+name+'('+args+'));')
    body='''
const request=JSON.parse(process.getBuiltinModule('fs').readFileSync(0,'utf8'));
const solution=new CLASS();
function call(name:string,args:any[]):any{count=0;seen.clear();switch(name){BRANCHES default:throw Error('invalid_input');}}
try{const result=request.calls?.length?request.calls.map((c:any)=>call(c.methodName,c.args)):call(METHOD,request.args);process.stderr.write('\\nQUOREM_RESULT:'+JSON.stringify(result));}
catch(e){if(e instanceof Error&&e.message==='invalid_output')process.exit(42);throw e;}
'''.replace('CLASS',r['signature']['className']).replace('BRANCHES',''.join(branches)).replace('METHOD',json.dumps(r['signature']['methodName']))
    return 'declare const process:any;\n'+h['TS_TYPES']+r['source']+'\n'+h['TS_ENCODER']+DECODER+body
