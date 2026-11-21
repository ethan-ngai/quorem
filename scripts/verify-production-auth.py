"""Exercise sign-in, authenticated API latency and revocation without logging credentials."""
import http.cookiejar
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def verify(origin, username, password):
    url = urllib.parse.urlsplit(origin)
    if url.scheme != "https" or url.netloc == "" or url.path or url.query or url.fragment:
        raise RuntimeError("An exact HTTPS production origin is required")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(jar))

    def call(path, body=None, cookie=None, expected=200):
        headers = {"Origin": origin, "User-Agent": "Quorem-Deployment-Probe/1.0"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if cookie:
            headers["Cookie"] = cookie
        request = urllib.request.Request(origin + path, headers=headers,
                                         data=json.dumps(body).encode() if body is not None else None)
        started = time.monotonic()
        try:
            response = opener.open(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        except (OSError, TimeoutError):
            raise RuntimeError("Production authentication transport failed") from None
        with response:
            if response.status != expected:
                raise RuntimeError(f"Production authentication check failed: {path} HTTP {response.status}")
            payload = response.read(65537)
            if len(payload) > 65536:
                raise RuntimeError("Authentication response exceeded its bound")
        print(f"{path} HTTP {expected} duration_ms={round((time.monotonic() - started) * 1000)}", flush=True)
        return json.loads(payload) if payload else None

    call("/api/auth/quorem-config")
    signed_in = False
    try:
        call("/api/auth/sign-in/username", {"username": username, "password": password})
        signed_in = True
        session_cookie = next((f"{cookie.name}={cookie.value}" for cookie in jar
                               if cookie.name == "__Secure-better-auth.session_token"), None)
        if not session_cookie:
            raise RuntimeError("Authentication cookie missing")
        for _ in range(3):
            session = call("/v1/session", cookie=session_cookie)
            if not isinstance(session, dict) or not session.get("user", {}).get("id"):
                raise RuntimeError("Authenticated API session missing")
        call("/api/auth/sign-out", {})
        signed_in = False
        call("/v1/session", cookie=session_cookie, expected=401)
    finally:
        if signed_in:
            call("/api/auth/sign-out", {})


if __name__ == "__main__":
    try:
        verify(os.environ["AUTH_ORIGIN"], os.environ["AUTH_BOOTSTRAP_USERNAME"],
               os.environ["AUTH_BOOTSTRAP_PASSWORD"])
    except Exception as error:
        # Never print request bodies, response bodies, cookies or exception representations.
        print(str(error) if isinstance(error, RuntimeError) else "Production authentication verification failed")
        raise SystemExit(1) from None
