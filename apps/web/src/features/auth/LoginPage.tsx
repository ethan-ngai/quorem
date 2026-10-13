import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { authMethod, signIn, signInWithPassword } from "./session";
import { Brand } from "../editor/components/Icon";
import "./auth.css";

export function LoginPage() {
  const method = useQuery({ queryKey: ["auth-method"], queryFn: authMethod, retry: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (method.data === "password") await signInWithPassword(username.trim(), password);
      else await signIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in unavailable. Try again.");
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <Brand />
      <section className="auth-content" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in to Quorem</h1>
        <p>Run code, join matches and save your work.</p>
        {method.isPending ? (
          <p role="status">Loading sign in…</p>
        ) : method.isError ? (
          <>
            <p role="alert">Sign in unavailable.</p>
            <button className="button" onClick={() => void method.refetch()}>
              Try again
            </button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            {method.data === "password" ? (
              <>
                <label>
                  Username
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={64}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={busy}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy
                ? "Signing in…"
                : method.data === "password"
                  ? "Sign in"
                  : "Continue to sign in"}
            </button>
          </form>
        )}
        <a href="/practice">Browse problems</a>
      </section>
    </main>
  );
}
