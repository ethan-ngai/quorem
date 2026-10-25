"""Build independent judge images concurrently; preserve each build's diagnostics."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess

languages = ("python", "java", "typescript", "ocaml")
Path("deploy/images").mkdir(parents=True, exist_ok=True)
Path(".local/deploy").mkdir(parents=True, exist_ok=True)


def build(language):
    path = Path(f".local/deploy/build-{language}.log")
    dockerfile = "apps/runner/Dockerfile" + ("" if language == "python" else f".{language}")
    tag = f"quorem-{language}:production"
    with path.open("w") as log:
        for command in (
            ["docker", "build", "-f", dockerfile, "-t", tag, "."],
            ["docker", "tag", tag, f"quorem-{language}:local"],
            ["docker", "save", tag, "-o", f"deploy/images/{language}.tar"],
        ):
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                raise RuntimeError(f"{language} build failed:\n{path.read_text()}")
    print(f"Built {language} judge image", flush=True)


with ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(build, languages))
