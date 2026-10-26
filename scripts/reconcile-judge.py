"""Publish one durable wake after both role rollouts, recovering pre-transition DB jobs."""
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def publish(account, queue, token, opener=None, sleep=time.sleep):
    if not all(re.fullmatch(r"[0-9a-fA-F]{32}", value) for value in (account, queue)):
        raise RuntimeError("Invalid deployment account or queue identifier")
    if not token:
        raise RuntimeError("Cloudflare deployment token required")
    if opener is None:
        opener = urllib.request.build_opener(NoRedirect()).open
    body = json.dumps({"content_type": "json", "body": {"jobId": "deployment-reconcile"}}).encode()
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/queues/{queue}/messages",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with opener(request, timeout=15) as response:
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise RuntimeError("Cloudflare wake response exceeded its bound")
                try:
                    payload = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    raise RuntimeError("Cloudflare wake response was invalid") from None
                if not isinstance(payload, dict) or payload.get("success") is not True:
                    raise RuntimeError("Cloudflare durable reconcile wake was rejected")
                return
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Cloudflare reconcile wake failed: HTTP {code}") from None
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise RuntimeError("Cloudflare durable reconcile wake timed out") from None
        # Duplicate wakes are safe: PostgreSQL claims and attempt fencing remain authoritative.
        sleep(2 ** attempt)


def main():
    queue = subprocess.check_output([
        "terraform", "-chdir=infra/terraform/app", "output", "-raw", "judge_queue_id",
    ], text=True).strip()
    publish(os.environ["CLOUDFLARE_ACCOUNT_ID"], queue, os.environ["CLOUDFLARE_API_TOKEN"])
    print("Durable judge reconcile wake published")


if __name__ == "__main__":
    main()
