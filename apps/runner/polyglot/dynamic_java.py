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
static Object decode(String t,Object v){
 if(t.startsWith("optional<"))return v==null?null:decode(t.substring(9,t.length()-1),v);
 if(t.startsWith("list<")||t.startsWith("array<")){java.util.List<?>xs=(java.util.List<?>)v;Object[]a=new Object[xs.size()];String inner=t.substring(t.startsWith("list<")?5:6,t.length()-1);for(int i=0;i<a.length;i++)a[i]=decode(inner,xs.get(i));return a;}
 if(t.equals("ListNode")){if(v==null)return null;java.util.List<?>xs=(java.util.List<?>)v;ListNode node=null;for(int i=xs.size()-1;i>=0;i--)node=new ListNode(((Number)xs.get(i)).intValue(),node);return node;}
 if(t.equals("TreeNode")){if(v==null)return null;java.util.List<?>xs=(java.util.List<?>)v;if(xs.isEmpty()||xs.get(0)==null)return null;TreeNode root=new TreeNode(((Number)xs.get(0)).intValue());java.util.ArrayList<TreeNode>q=new java.util.ArrayList<>();q.add(root);int i=1;for(int p=0;p<q.size()&&i<xs.size();p++){TreeNode n=q.get(p);Object left=xs.get(i++);if(left!=null){n.left=new TreeNode(((Number)left).intValue());q.add(n.left);}if(i<xs.size()){Object right=xs.get(i++);if(right!=null){n.right=new TreeNode(((Number)right).intValue());q.add(n.right);}}}return root;}
 if(t.equals("float"))return ((Number)v).doubleValue();if(t.equals("int"))return ((Number)v).intValue();return v;
}
'''

def source(r, h):
    signatures = dict(r.get('methods') or {})
    signatures[r['signature']['methodName']] = r['signature']
    branches = []
    for name, sig in signatures.items():
        args = ','.join('decode('+json.dumps(p['type'])+',args.get('+str(i)+'))' for i,p in enumerate(sig['parameters']))
        encoded = '"null"' if sig['returnType']=='void' else 'encode('+json.dumps(sig['returnType'])+',value,0)'
        branches.append('case '+json.dumps(name)+':{if(args.size()!='+str(len(sig['parameters']))+')throw new IllegalArgumentException();Object value=invoke(solution,'+json.dumps(name)+',new Object[]{'+args+'});count=0;seen.clear();return '+encoded+';}')
    call = 'static String call(Object solution,String name,java.util.List<Object>args)throws Exception{switch(name){'+''.join(branches)+'default:throw new IllegalArgumentException();}}'
    main = '''public static void main(String[] argv)throws Exception {
 java.util.Map<String,Object>request=(java.util.Map<String,Object>)new Json(new String(System.in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)).value(0);
 Object solution=new CLASS();java.util.List<?>calls=(java.util.List<?>)request.get("calls");String output;
 if(calls!=null&&!calls.isEmpty()){java.util.ArrayList<String>results=new java.util.ArrayList<>();for(Object raw:calls){java.util.Map<String,Object>c=(java.util.Map<String,Object>)raw;results.add(call(solution,(String)c.get("methodName"),(java.util.List<Object>)c.get("args")));}output="["+String.join(",",results)+"]";}
 else output=call(solution,METHOD,(java.util.List<Object>)request.get("args"));
 System.err.print("\\nQUOREM_RESULT:"+output);
}'''.replace('CLASS',r['signature']['className']).replace('METHOD',json.dumps(r['signature']['methodName']))
    return 'import java.util.*;\n'+h['JAVA_TYPES']+r['source']+'\nclass Main {\n'+h['JAVA_ENCODER']+PARSER+call+main+'\n}'
