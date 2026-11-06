/** @file sudo.ts @description Shared, deduplicated sudo prompt and server-owned expiry. @module auth */
import { AuthError } from "./errors";
import { resetToken } from "./session";
export type SudoStatus = {
  userId: string;
  until: number;
  methods: { password: boolean; passkey: boolean; email: boolean };
};
export async function sudoRequest<T = void>(path: string, body?: object): Promise<T> {
  const response = await fetch(`/api/auth/sudo/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    if (response.status === 429) throw new AuthError("Too many attempts. Try again later.");
    if (response.status === 401) throw new AuthError("Sign in again to continue.");
    if (response.status === 400 && path === "password") throw new AuthError("Incorrect password.");
    if (response.status === 400 && path === "email-code")
      throw new AuthError("Code expired or incorrect. Try again or request a new code.");
    throw new AuthError("Verification unavailable. Try again.");
  }
  return response.json();
}
type Prompt = { status: SudoStatus; resolve: () => void; reject: (error: Error) => void };
let prompt: Prompt | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
export const sudoSnapshot = () => prompt;
export function subscribeSudo(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function emit() {
  for (const listener of listeners) listener();
}
export function cancelSudo() {
  prompt?.reject(new AuthError("Verification cancelled."));
}
/** Only successful server verification resumes the protected action. */
export async function completeSudo() {
  if (!prompt) return;
  resetToken();
  const status = await sudoRequest<SudoStatus>("status");
  if (status.userId !== prompt.status.userId)
    throw new AuthError("Account changed. Reload before continuing.");
  if (status.until <= Date.now() / 1000)
    throw new AuthError("Verification could not be confirmed. Try again.");
  prompt.resolve();
}
export function requireSudo(): Promise<void> {
  return (pending ??= (async () => {
    const status = await sudoRequest<SudoStatus>("status");
    if (status.until > Date.now() / 1000) return;
    await new Promise<void>((resolve, reject) => {
      prompt = { status, resolve, reject };
      emit();
    });
  })().finally(() => {
    pending = undefined;
    prompt = undefined;
    emit();
  }));
}
