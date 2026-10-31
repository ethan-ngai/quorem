"""Sample the test's workerd process RSS; the database fixture must already exist."""
import os
import subprocess
import time

command = ["vp", "exec", "vitest", "run", "--config", "src/adapters/postgres/judging/admission/inputs.workers.config.ts"]
process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=os.environ.copy())
peak_kib = 0
while process.poll() is None:
    lines = subprocess.run(["ps", "-axo", "pid,ppid,rss,comm"], capture_output=True, text=True).stdout.splitlines()
    processes = {}
    for line in lines[1:]:
        parts = line.strip().split(None, 3)
        if len(parts) == 4:
            processes[int(parts[0])] = (int(parts[1]), int(parts[2]), parts[3])
    for pid, (_, rss, name) in processes.items():
        if os.path.basename(name) != "workerd":
            continue
        ancestor = pid
        while ancestor in processes and ancestor != process.pid:
            parent = processes[ancestor][0]
            if parent == ancestor:
                break
            ancestor = parent
        if ancestor == process.pid:
            peak_kib = max(peak_kib, rss)
    time.sleep(0.02)
print(process.stdout.read())
if peak_kib == 0:
    raise RuntimeError("test workerd process was not observed")
print("Observed test workerd process peak RSS KiB:", peak_kib)
raise SystemExit(process.returncode)
