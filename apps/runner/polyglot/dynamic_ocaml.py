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
let dec_node = function JNull -> None | v -> List.fold_left (fun next x -> Some {value=dec_int x;next}) None (List.rev (array v))
let dec_tree = function JNull -> None | v ->
 let xs=Array.of_list (array v) in if Array.length xs=0 || xs.(0)=JNull then None else
 let node v : tree_node = {value=dec_int v;left=None;right=None} in
 let root=node xs.(0) and q=Queue.create () and i=ref 1 in
 Queue.add root q;
 while not (Queue.is_empty q) && !i<Array.length xs do
  let p=Queue.take q in
  let child () = if !i>=Array.length xs then None else (let v=xs.(!i) in incr i;if v=JNull then None else (let n=node v in Queue.add n q;Some n)) in
  p.left<-child ();p.right<-child ()
 done;Some root
'''

def decoder(t):
    if t.startswith('optional<'):return '(dec_optional '+decoder(t[9:-1])+')'
    if t.startswith('list<'):return '(dec_list '+decoder(t[5:-1])+')'
    if t.startswith('array<'):return '(dec_array '+decoder(t[6:-1])+')'
    return {'int':'dec_int','float':'dec_float','bool':'dec_bool','str':'dec_str','datetime':'dec_datetime','ListNode':'dec_node','TreeNode':'dec_tree'}[t]

def source(r,h):
    signatures=dict(r.get('methods') or {})
    signatures[r['signature']['methodName']]=r['signature']
    branches=[]
    for name,sig in signatures.items():
        args=' '.join('('+decoder(p['type'])+' args.('+str(i)+'))' for i,p in enumerate(sig['parameters'])) or '()'
        branches.append('| '+json.dumps(name)+' -> if Array.length args<>'+str(len(sig['parameters']))+' then invalid ();let value=Solution.'+name+' '+args+' in count:=0;'+h['ocaml_encoder'](sig['returnType'])+' 0 value')
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
