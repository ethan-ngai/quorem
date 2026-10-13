package engine

import (
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"testing"
)

func TestDockerLanguageUnicodeParity(t *testing.T) {
	fixtures := dockerTests(t)
	for _, f := range fixtures {
		if f.Problem.Slug != "mirror-letters" && f.Problem.Slug != "quota-window" {
			continue
		}
		var cases []worker.Case
		if f.Problem.Slug == "mirror-letters" {
			cases = []worker.Case{{Args: []json.RawMessage{json.RawMessage(`"a😀béz"`)}, Expected: json.RawMessage(`"z😀béa"`)}}
		} else {
			cases = []worker.Case{{Args: []json.RawMessage{json.RawMessage(`"x😀a😀b"`), json.RawMessage(`"😀b"`)}, Expected: json.RawMessage(`"😀b"`)}}
		}
		for _, language := range []string{"java", "typescript", "ocaml"} {
			t.Run(language+"/"+f.Problem.Slug, func(t *testing.T) {
				t.Parallel()
				source, err := os.ReadFile("../../../api/internal/problems/references/" + language + "/" + f.Problem.Slug + ".txt")
				if err != nil {
					t.Fatal(err)
				}
				result := executeLanguage(t, f, language, string(source), "run", cases)
				if result.Verdict != execution.Accepted {
					t.Fatalf("%+v", result)
				}
			})
		}
	}
}

func TestDockerLanguageCodecParity(t *testing.T) {
	f := dockerTests(t)[0]
	for _, test := range []struct{ language, source string }{
		{"java", "class Solution {public String[][] solve(String[][] values){return values;}}"},
		{"typescript", "class Solution {solve(values:(string|null)[][]):(string|null)[][]{return values;}}"},
		{"ocaml", "let solve (values:string option list list) = values"},
	} {
		t.Run(test.language, func(t *testing.T) {
			t.Parallel()
			f := f
			f.Problem.Signature.Parameters = append(f.Problem.Signature.Parameters[:0:0], f.Problem.Signature.Parameters...)
			f.Problem.Signature.MethodName = "solve"
			f.Problem.Signature.Parameters[0].Name = "values"
			f.Problem.Signature.Parameters[0].Type = "list<list<optional<str>>>"
			f.Problem.Signature.ReturnType = "list<list<optional<str>>>"
			value := json.RawMessage(`[["a😀",null,"\"\\\n"],[]]`)
			result := executeLanguage(t, f, test.language, test.source, "run", []worker.Case{{Args: []json.RawMessage{value}, Expected: value}})
			if result.Verdict != execution.Accepted {
				t.Fatalf("%+v", result)
			}
		})
	}
}

func TestDockerLanguageNodeCyclesAndIsolation(t *testing.T) {
	fixtures := dockerTests(t)
	for _, f := range fixtures {
		if f.Problem.Slug != "segment-sums" {
			continue
		}
		for _, test := range []struct{ language, cycle, isolation string }{
			{"java", "class Solution {public ListNode segmentSums(ListNode h){ListNode n=new ListNode(1);n.next=n;return n;}}", "class Solution {public ListNode segmentSums(ListNode h)throws Exception{if(System.getenv(\"DATABASE_URL\")!=null||java.nio.file.Files.exists(java.nio.file.Path.of(\"/Users/engai\")))throw new Exception();try{java.nio.file.Files.writeString(java.nio.file.Path.of(\"/etc/quorem-probe\"),\"x\");throw new Exception();}catch(java.nio.file.FileSystemException expected){}return h;}}"},
			{"typescript", "class Solution {segmentSums(h:ListNode|null):ListNode|null{const n=new ListNode(1);n.next=n;return n;}}", "declare const require:any;class Solution {segmentSums(h:ListNode|null):ListNode|null{const fs=require('node:fs');if(process.env.DATABASE_URL||fs.existsSync('/Users/engai'))throw Error('unsafe');let failed=false;try{fs.writeFileSync('/etc/quorem-probe','x');}catch{failed=true;}if(!failed)throw Error('writable');return h;}}"},
			{"ocaml", "let segmentSums (h:list_node option) = let n={value=1;next=None} in n.next <- Some n; Some n", "let segmentSums (h:list_node option) = if Sys.getenv_opt \"DATABASE_URL\" <> None || Sys.file_exists \"/Users/engai\" then failwith \"unsafe\"; let failed=try let f=open_out \"/etc/quorem-probe\" in close_out f;false with Sys_error _ -> true in if not failed then failwith \"writable\";h"},
		} {
			t.Run(test.language, func(t *testing.T) {
				t.Parallel()
				result := executeLanguage(t, f, test.language, test.cycle, "run", f.Problem.SampleCases()[:1])
				if result.Verdict != execution.InvalidOutput {
					t.Fatal(result)
				}
				value := json.RawMessage(`[1,2,3]`)
				result = executeLanguage(t, f, test.language, test.isolation, "run", []worker.Case{{Args: []json.RawMessage{value}, Expected: value}})
				if result.Verdict != execution.Accepted {
					t.Fatal(result)
				}
			})
		}
	}
}

func TestDockerLanguagePrimitiveParity(t *testing.T) {
	f := dockerTests(t)[0]
	for _, kind := range []string{"bool", "list<float>"} {
		for _, language := range []string{"java", "typescript", "ocaml"} {
			t.Run(language+"/"+kind, func(t *testing.T) {
				t.Parallel()
				fixture := f
				fixture.Problem.Signature.Parameters = append(f.Problem.Signature.Parameters[:0:0], f.Problem.Signature.Parameters...)
				fixture.Problem.Signature.MethodName = "solve"
				fixture.Problem.Signature.Parameters[0].Name = "value"
				fixture.Problem.Signature.Parameters[0].Type = kind
				fixture.Problem.Signature.ReturnType = kind
				value := json.RawMessage(`true`)
				source := map[string]string{"java": "class Solution {public boolean solve(boolean value){return value;}}", "typescript": "class Solution {solve(value:boolean):boolean{return value;}}", "ocaml": "let solve (value:bool) = value"}[language]
				if kind == "list<float>" {
					value = json.RawMessage(`[-0.0,1.25,1000.0]`)
					source = map[string]string{"java": "class Solution {public double[] solve(double[] value){return value;}}", "typescript": "class Solution {solve(value:number[]):number[]{return value;}}", "ocaml": "let solve (value:float list) = value"}[language]
				}
				result := executeLanguage(t, fixture, language, source, "run", []worker.Case{{Args: []json.RawMessage{value}, Expected: value}})
				if result.Verdict != execution.Accepted {
					t.Fatal(result)
				}
			})
		}
	}
}
