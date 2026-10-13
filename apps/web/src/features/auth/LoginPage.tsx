import { useState } from "react";
import { signIn } from "./session";
export function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="workspace-loading">
      <h1>Sign in to Quorem</h1>
      <p>Continue to your account to run code and join matches.</p>
      <button
        className="button button-primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signIn().catch(() => {
            setError("Sign in unavailable. Try again.");
            setBusy(false);
          });
        }}
      >
        {busy ? "Opening sign in…" : "Continue to sign in"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        Sign up, email verification, password reset and Google sign in are available on the account
        page.
      </p>
      <a href="/practice">Browse problems</a>
    </main>
  );
}
