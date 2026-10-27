"""Start the remote-case judge or run deployment isolation probes."""
import os
import subprocess
import sys

if not os.environ.get('QUOREM_CASE_SANDBOX_ORIGIN'):
    raise SystemExit('Case sandbox origin required')
if any(os.environ.get(name) for name in ('BETTER_AUTH_SECRET', 'AUTH_INTERNAL_SECRET', 'QUOREM_INVITE_KEY', 'AUTH_DATABASE_URL')):
    raise SystemExit('Judge must not receive application credentials')
if '--verify-only' in sys.argv[1:]:
    subprocess.run(['/app/bin/runner', '--verify-sandbox'], check=True)
else:
    os.execv('/app/bin/runner', ['/app/bin/runner', '--http'])
