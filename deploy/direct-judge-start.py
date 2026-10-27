"""Run isolation preflight before the remote-case judge accepts work."""
import os
import subprocess
import sys
import time

if not os.environ.get('QUOREM_CASE_SANDBOX_ORIGIN'):
    raise SystemExit('Case sandbox origin required')
if any(os.environ.get(name) for name in ('BETTER_AUTH_SECRET', 'AUTH_INTERNAL_SECRET', 'QUOREM_INVITE_KEY', 'AUTH_DATABASE_URL')):
    raise SystemExit('Judge must not receive application credentials')
verify = '--verify-sandbox' if '--verify-only' in sys.argv[1:] else '--verify-python-sandbox'
started = time.monotonic()
subprocess.run(['/app/bin/runner', verify], check=True)
print(f'judge initialization phase=preflight duration_ms={round((time.monotonic() - started) * 1000)}', flush=True)
if '--verify-only' not in sys.argv[1:]:
    os.execv('/app/bin/runner', ['/app/bin/runner', '--http'])
