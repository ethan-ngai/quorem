"""Bounded JSON input and signature-derived OCaml argument adapters."""
import json

PARSER = r'''
type json = JNull | JBool of bool | JNumber of string | JString of string | JArray of json list | JObject of (string * json) list
let invalid () = failwith "invalid_input"
let read_all ic = let b=Buffer.create 4096 in (try while true do Buffer.add_channel b ic 1 done with End_of_file -> ()); Buffer.contents b
let parse_json s =
 let pos=ref 0 and len=String.length s in
 let take () = if !pos>=len then invalid (); let c=s.[!pos] in incr pos;c in
 let peek () = if !pos>=len then invalid ();s.[!pos] in
 let rec ws () = if !pos<len && List.mem s.[!pos] [' ';'\n';'\r';'\t'] then (incr pos;ws ()) in
 let unicode b v =
  if v<128 then Buffer.add_char b (Char.chr v)
  else if v<2048 then (Buffer.add_char b (Char.chr (192 lor (v lsr 6)));Buffer.add_char b (Char.chr (128 lor (v land 63))))
  else if v<65536 then (Buffer.add_char b (Char.chr (224 lor (v lsr 12)));Buffer.add_char b (Char.chr (128 lor ((v lsr 6) land 63)));Buffer.add_char b (Char.chr (128 lor (v land 63))))
  else (Buffer.add_char b (Char.chr (240 lor (v lsr 18)));Buffer.add_char b (Char.chr (128 lor ((v lsr 12) land 63)));Buffer.add_char b (Char.chr (128 lor ((v lsr 6) land 63)));Buffer.add_char b (Char.chr (128 lor (v land 63)))) in
 let hex () = if !pos+4>len then invalid ();let n=int_of_string ("0x"^String.sub s !pos 4) in pos:= !pos+4;n in
 let string () =
  if take ()<>'"' then invalid ();let b=Buffer.create 32 in
  let rec loop () = match take () with
   | '"' -> Buffer.contents b
   | '\\' -> (match take () with
    | ('"'|'\\'|'/') as c -> Buffer.add_char b c
    | 'b' -> Buffer.add_char b '\b' | 'f' -> Buffer.add_char b '\012'
    | 'n' -> Buffer.add_char b '\n' | 'r' -> Buffer.add_char b '\r' | 't' -> Buffer.add_char b '\t'
    | 'u' -> let n=hex () in let n=if n>=0xd800 && n<=0xdbff then (if take ()<>'\\' || take ()<>'u' then invalid ();let low=hex () in if low<0xdc00 || low>0xdfff then invalid ();0x10000+((n-0xd800) lsl 10)+(low-0xdc00)) else n in unicode b n
    | _ -> invalid ());loop ()
   | c -> Buffer.add_char b c;loop () in loop () in
 let rec value depth =
  if depth>110 then invalid ();ws ();match peek () with
  | '"' -> JString (string ())
  | '[' -> incr pos;ws ();if peek ()=']' then (incr pos;JArray []) else
    let rec items acc = let v=value (depth+1) in ws ();match take () with ']' -> JArray (List.rev (v::acc)) | ',' -> items (v::acc) | _ -> invalid () in items []
  | '{' -> incr pos;ws ();if peek ()='}' then (incr pos;JObject []) else
    let rec fields acc = ws ();let k=string () in ws ();if take ()<>':' then invalid ();let v=value (depth+1) in ws ();match take () with '}' -> JObject (List.rev ((k,v)::acc)) | ',' -> fields ((k,v)::acc) | _ -> invalid () in fields []
  | 'n' -> if !pos+4>len || String.sub s !pos 4<>"null" then invalid ();pos:= !pos+4;JNull
  | 't' -> if !pos+4>len || String.sub s !pos 4<>"true" then invalid ();pos:= !pos+4;JBool true
  | 'f' -> if !pos+5>len || String.sub s !pos 5<>"false" then invalid ();pos:= !pos+5;JBool false
  | _ -> let start= !pos in while !pos<len && List.mem s.[!pos] ['-';'+';'0';'1';'2';'3';'4';'5';'6';'7';'8';'9';'.';'e';'E'] do incr pos done;if !pos=start then invalid ();JNumber (String.sub s start (!pos-start)) in
 let result=value 0 in ws ();if !pos<>len then invalid ();result
let field name = function JObject xs -> (try List.assoc name xs with Not_found -> JNull) | _ -> invalid ()
let array = function JArray xs -> xs | _ -> invalid ()
let dec_int = function JNumber s -> let n=int_of_string s in if n< -2147483648 || n>2147483647 then invalid ();n | _ -> invalid ()
let dec_float = function JNumber s -> float_of_string s | _ -> invalid ()
let dec_bool = function JBool v -> v | _ -> invalid ()
let dec_str = function JString s -> s | _ -> invalid ()
let dec_long v = Int64.of_string (dec_str v)
let dec_datetime v =
 let s=dec_str v in
 let n start len = int_of_string (String.sub s start len) in
 let y=n 0 4 and m=n 5 2 and day=n 8 2 in
 let leap = y mod 4 = 0 && (y mod 100 <> 0 || y mod 400 = 0) in
 let months = [|31; (if leap then 29 else 28);31;30;31;30;31;31;30;31;30;31|] in
 let yday = ref (day-1) in for i=0 to m-2 do yday := !yday + months.(i) done;
 let prev=y-1 in let days=365*prev+prev/4-prev/100+prev/400+ !yday in
 {Unix.tm_sec=n 17 2;tm_min=n 14 2;tm_hour=n 11 2;tm_mday=day;tm_mon=m-1;tm_year=y-1900;tm_wday=(days+1) mod 7;tm_yday= !yday;tm_isdst=false}
let dec_list f v = List.map f (array v)
let dec_array f v = Array.of_list (dec_list f v)
let dec_optional f = function JNull -> None | v -> Some (f v)
let dec_node f = function JNull -> None | v -> List.fold_left (fun next x -> Some {value=f x;next}) None (List.rev (array v))
let dec_tree f = function JNull -> None | v ->
 let xs=Array.of_list (array v) in if Array.length xs=0 || xs.(0)=JNull then None else
 let node v : _ typed_tree_node = {value=f v;left=None;right=None} in
 let root=node xs.(0) and q=Queue.create () and i=ref 1 in
 Queue.add root q;
 while not (Queue.is_empty q) && !i<Array.length xs do
  let p=Queue.take q in
  let child () = if !i>=Array.length xs then None else (let v=xs.(!i) in incr i;if v=JNull then None else (let n=node v in Queue.add n q;Some n)) in
  p.left<-child ();p.right<-child ()
 done;Some root
let dec_nary f = function JNull -> None | v ->
 match array v with
 | [] | JNull::_ -> None
 | item::tail ->
  let node v : _ nary_tree_node = {value=f v;children=[]} in
  let root = node item and parents = Queue.create () in
  Queue.add root parents;
  let rec children acc = function
   | [] -> List.rev acc, []
   | JNull::rest -> List.rev acc, rest
   | item::rest ->
    let child = node item in
    Queue.add child parents;
    children (child::acc) rest in
  let rec groups = function
   | [] -> ()
   | items ->
    let parent = Queue.take parents in
    let nodes, rest = children [] items in
    parent.children <- nodes;
    groups rest in
  (match tail with [] -> () | JNull::rest -> groups rest | _ -> invalid ());
  Some root
let original_nodes children root =
 let q = Queue.create () and result = ref [] in
 Option.iter (fun node -> Queue.add node q) root;
 while not (Queue.is_empty q) do
  let node = Queue.take q in
  result := node :: !result;
  List.iter (fun child -> Queue.add child q) (children node)
 done;
 Array.of_list (List.rev !result)
let list_nodes root = original_nodes (fun (node:_ typed_list_node) -> Option.to_list node.next) root
let tree_nodes root = original_nodes (fun (node:_ typed_tree_node) -> List.filter_map Fun.id [node.left;node.right]) root
let nary_nodes root = original_nodes (fun (node:_ nary_tree_node) -> node.children) root
let is_record = function JObject _ -> true | _ -> false
let seed = function JObject _ as v -> field "values" v | v -> v
let index_reference = function JArray [a;i] -> dec_int a, dec_int i | _ -> invalid ()
let returned_index nodes node =
 let rec find i = if i = Array.length nodes then None
  else if nodes.(i) == node then Some i else find (i+1) in
 find 0
'''

def decoder(t):
    if t.startswith('optional<'):return '(dec_optional '+decoder(t[9:-1])+')'
    if t.startswith('list<'):return '(dec_list '+decoder(t[5:-1])+')'
    if t.startswith('array<'):return '(dec_array '+decoder(t[6:-1])+')'
    if t == 'ListNode' or t.startswith('ListNode<'):
        return '(dec_node ' + decoder(t[9:-1] if '<' in t else 'int') + ')'
    if t == 'NaryTreeNode' or t.startswith('NaryTreeNode<'):
        return '(dec_nary ' + decoder(t[13:-1] if '<' in t else 'int') + ')'
    if t == 'TreeNode' or t.startswith('TreeNode<'):
        return '(dec_tree ' + decoder(t[9:-1] if '<' in t else 'int') + ')'
    return {'int':'dec_int','long':'dec_long','float':'dec_float','bool':'dec_bool','str':'dec_str','datetime':'dec_datetime'}[t]

def source(r,h):
    signatures=dict(r.get('methods') or {})
    signatures[r['signature']['methodName']]=r['signature']
    branches=[]
    for name,sig in signatures.items():
        types = [p['type'] for p in sig['parameters']]
        node_helpers = {'ListNode': 'list_nodes', 'TreeNode': 'tree_nodes', 'NaryTreeNode': 'nary_nodes'}
        nodes = {i: node_helpers[t.split('<')[0]] for i,t in enumerate(types) if t.split('<')[0] in node_helpers}
        binding = []
        for i,t in enumerate(types):
            expression = f'(seed args.({i}))' if i in nodes else f'args.({i})'
            binding.append(f'let arg{i}={decoder(t)} {expression} in ')
        return_type = sig['returnType']
        reference = sig.get('nodeReferences') == 'return'
        if nodes:
            binding.append('let needs_seeds=' + ('true' if reference else 'Array.exists is_record args') + ' in ')
        for i, helper in nodes.items():
            binding.append(f'let seed{i}=if needs_seeds then {helper} arg{i} else [||] in ')
        for i,helper in nodes.items():
            candidates = ' '.join(f'| {j} -> seed{j}.(index)' for j in nodes if types[j] == types[i])
            binding.append(f'let resolve{i} ref_value=let argument,index=index_reference ref_value in match argument with {candidates} | _ -> invalid () in ')
            if helper == 'list_nodes':
                binding.append(f'(if is_record args.({i}) then match field "tail" args.({i}) with JNull -> () | tail -> seed{i}.(Array.length seed{i}-1).next <- Some (resolve{i} tail)); ')
            binding.append(f'let arg{i}=if is_record args.({i}) then match field "ref" args.({i}) with JNull -> arg{i} | ref_value -> Some (resolve{i} ref_value) else arg{i} in ')
        args = ' '.join(f'arg{i}' for i in range(len(types))) or '()'
        if reference:
            encoded = 'failwith "invalid_output"'
            for i in reversed(nodes):
                if types[i] == return_type:
                    encoded = f'(match returned_index seed{i} node with Some index -> Printf.sprintf "{{\\"ref\\":[{i},%d]}}" index | None -> {encoded})'
            encoded = f'(match value with None -> "null" | Some node -> {encoded})'
        else:
            encoded = h['ocaml_encoder'](return_type)+' 0 value'
        branches.append(f'| {json.dumps(name)} -> if Array.length args<>{len(types)} then invalid ();{"".join(binding)}let value=Solution.{name} {args} in count:=0;{encoded}')
    call='let call name args = let args=Array.of_list (array args) in match name with '+''.join(branches)+' | _ -> invalid ()\n'
    main='''let () = try
 let request=parse_json (read_all stdin) in
 let calls=field "calls" request in
 let output=match calls with JArray (_::_) ->
  let values=List.rev (List.fold_left (fun acc c -> let value=call (dec_str (field "methodName" c)) (field "args" c) in value::acc) [] (array calls)) in "["^String.concat "," values^"]"
 | _ -> call METHOD (field "args" request) in
 prerr_string ("\\nQUOREM_RESULT:"^output)
 with Failure message when message="invalid_output" -> exit 42
'''.replace('METHOD',json.dumps(r['signature']['methodName']))
    return h['OCAML_TYPES']+'\nmodule Solution = struct\n'+r['source']+'\nend\n'+h['OCAML_ENCODER']+PARSER+call+main
