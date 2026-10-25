"""Bounded, read-only Cloudflare metadata requests for Terraform deployment."""
import json
import os
import time
import urllib.error
import urllib.request


def get(path, missing_ok=False):
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
                if payload.get("success") is False:
                    raise RuntimeError("Cloudflare metadata lookup was rejected")
                return payload["result"]
        except urllib.error.HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Cloudflare metadata lookup failed: HTTP {error.code}") from None
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise RuntimeError("Cloudflare metadata lookup timed out") from None
        time.sleep(2 ** attempt)
