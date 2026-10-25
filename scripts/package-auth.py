"""Archive the installed auth dependency closure, preserving workspace/store symlinks."""
from pathlib import Path
import tarfile

root = Path(__file__).resolve().parent.parent
pending = [Path("apps/auth/node_modules"), Path("packages/contracts/node_modules")]
included = set()
while pending:
    relative = pending.pop()
    if relative in included or not (root / relative).exists():
        continue
    included.add(relative)
    for link in (root / relative).rglob("*"):
        if not link.is_symlink():
            continue
        target = link.resolve().relative_to(root)
        parts = target.parts
        if parts[:2] == ("node_modules", ".pnpm"):
            pending.append(Path(*parts[:3]))
        elif "node_modules" in parts:
            pending.append(target)
        else:
            pending.append(target / "node_modules")

output = root / "deploy/runtime-deps/deps.tar"
output.parent.mkdir(parents=True, exist_ok=True)
with tarfile.open(output, "w", dereference=False) as archive:
    for path in sorted(included):
        archive.add(root / path, arcname=str(path))
print(f"Packaged {len(included)} dependency directories")
