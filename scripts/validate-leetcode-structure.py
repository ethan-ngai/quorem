#!/usr/bin/env python3
"""Validate candidate JSON with Quorem's publication validator."""
import argparse
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GO = r'''package main
import("bytes";"crypto/sha256";"encoding/hex";"encoding/json";"fmt";"io";"os";"path/filepath";"strings";"github.com/ethan-ngai/quorem/apps/api/internal/problems")
type result struct{ID string `json:"id"`; SHA string `json:"sha256"`; Error string `json:"error"`}
func main(){paths,e:=filepath.Glob(filepath.Join(os.Args[1],"*.json"));if e!=nil{panic(e)};enc:=json.NewEncoder(os.Stdout);for _,p:=range paths{data,e:=os.ReadFile(p);if e!=nil{panic(e)};sum:=sha256.Sum256(data);r:=result{ID:strings.TrimSuffix(filepath.Base(p),".json"),SHA:hex.EncodeToString(sum[:])};var c problems.QuestionContent;dec:=json.NewDecoder(bytes.NewReader(data));dec.DisallowUnknownFields();if e=dec.Decode(&c);e==nil{var extra any;if dec.Decode(&extra)!=io.EOF{e=fmt.Errorf("multiple JSON values or invalid trailing data")}else{c=problems.NormalizeQuestionDraft(c);e=problems.ValidateQuestionPublication(c)}};if e!=nil{r.Error=e.Error()};if e=enc.Encode(r);e!=nil{panic(e)}}}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='.leetcode-validation-', dir=ROOT / 'apps/api') as directory:
        source = Path(directory) / 'main.go'
        source.write_text(GO)
        subprocess.run(['go', 'run', str(source), str(args.directory.resolve())], cwd=ROOT, check=True)


if __name__ == '__main__':
    main()
