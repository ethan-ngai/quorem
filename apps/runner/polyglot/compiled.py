"""Compile artifacts contain the submitted program and type adapters, never test inputs."""
import base64
import json
import os
import re
from pathlib import Path
import dynamic_java
import dynamic_typescript
import dynamic_ocaml

MAX_ARTIFACT=4*1024*1024
MAX_FILES=256

def command(lang):
    if lang=='java':return ['java','-Xmx128m','-XX:ActiveProcessorCount=1','-XX:+UseSerialGC','-XX:-UsePerfData','-cp','/tmp','Main']
    if lang=='typescript':return ['node','--max-old-space-size=128','/tmp/main.js']
    return ['ocamlrun','/tmp/main.byte']

def prepare(r,lang,h):
    # Compiler operation deliberately receives no current or future case data.
    if any(k in r for k in ('args','calls','cases','expected','artifact')):raise ValueError('case data in compiler request')
    if lang=='java':
        Path('/tmp/Main.java').write_text(dynamic_java.source(r,h))
        return ['javac','-J-Xmx128m','-J-XX:ActiveProcessorCount=1','-J-XX:+UseSerialGC','-J-XX:-UsePerfData','/tmp/Main.java']
    if lang=='typescript':
        Path('/tmp/main.ts').write_text(dynamic_typescript.source(r,h))
        return ['tsc','--strict','--target','ES2022','--module','commonjs','--skipLibCheck','--outDir','/tmp','/tmp/main.ts']
    Path('/tmp/main.ml').write_text(dynamic_ocaml.source(r,h))
    return ['ocamlc','-I','+unix','-o','/tmp/main.byte','unix.cma','/tmp/main.ml']

def valid_name(name,lang):
    if not isinstance(name,str) or len(name)>255 or '/' in name or '\\' in name or '\0' in name or name.startswith('.'):return False
    if lang=='java':return name.endswith('.class') and len(name)>6
    return name=={'typescript':'main.js','ocaml':'main.byte'}[lang]

def validate(artifact,lang):
    if not isinstance(artifact,dict) or set(artifact)!= {'version','language','files'} or artifact['version']!=1 or artifact['language']!=lang:raise ValueError('invalid artifact')
    files=artifact['files']
    if not isinstance(files,dict) or not 1<=len(files)<=MAX_FILES or len(json.dumps(artifact).encode())>MAX_ARTIFACT:raise ValueError('artifact limit')
    if {'java':'Main.class','typescript':'main.js','ocaml':'main.byte'}[lang] not in files:raise ValueError('missing entrypoint')
    decoded={}
    for name,value in files.items():
        if not valid_name(name,lang) or not isinstance(value,str):raise ValueError('invalid artifact file')
        decoded[name]=base64.b64decode(value,validate=True)
    return decoded

def collect(lang):
    files={}
    for entry in os.scandir('/tmp'):
        if valid_name(entry.name,lang):
            if not entry.is_file(follow_symlinks=False):raise ValueError('invalid artifact type')
            size=entry.stat(follow_symlinks=False).st_size
            if size>MAX_ARTIFACT or len(files)>=MAX_FILES:raise ValueError('artifact limit')
            files[entry.name]=base64.b64encode(Path(entry.path).read_bytes()).decode('ascii')
    artifact={'version':1,'language':lang,'files':files}
    validate(artifact,lang)
    return artifact

def install(artifact,lang):
    for name,value in validate(artifact,lang).items():
        # /tmp is a fresh case-private tmpfs; no other case artifacts or inputs exist.
        with open('/tmp/'+name,'xb') as target:target.write(value)
