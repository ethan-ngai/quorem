/** @file fence.ts @description Durable local attempt exclusion and tombstones. @module runner */
import { lstat, open, readFile, realpath, mkdir, rmdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import type { AttemptFence } from "@quorem/execution";
import { UnconfirmedTeardown } from "./types.ts";

function code(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
/** A lost lock is not reclaimed by time; an operator must establish actual executor termination. */
export async function localFenceRoot(path: string, namespace: string, daemon: string) {
  const root = resolve(path),
    canonical = await realpath(root);
  if (root !== canonical || !namespace) throw new Error("Invalid sandbox state directory");
  const initial = await lstat(root, { bigint: true }),
    uid = process.getuid?.();
  if (
    !initial.isDirectory() ||
    initial.isSymbolicLink() ||
    uid === undefined ||
    initial.uid !== BigInt(uid) ||
    (initial.mode & 0o077n) !== 0n
  )
    throw new Error("Invalid sandbox state directory");
  const scope = `docker:${createHash("sha256")
    .update(JSON.stringify([daemon, namespace, initial.dev.toString(), initial.ino.toString()]))
    .digest("hex")}`;
  const prefix = createHash("sha256").update(scope).digest("hex").slice(0, 16);
  const verify = async () => {
    const current = await lstat(root, { bigint: true });
    if (
      (await realpath(root)) !== root ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== initial.dev ||
      current.ino !== initial.ino ||
      current.uid !== initial.uid ||
      (current.mode & 0o077n) !== 0n
    )
      throw new UnconfirmedTeardown();
  };
  const syncDirectory = async () => {
    const fd = await open(root, "r");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  };
  const names = (fence: AttemptFence) => {
    if (fence.sandboxScope !== scope || !/^[A-Za-z0-9-]{1,128}$/.test(fence.attemptId))
      throw new UnconfirmedTeardown();
    const stem = `attempt-${prefix}-${fence.attemptId}`;
    return {
      lock: join(root, `${stem}.lock`),
      tombstone: join(root, `${stem}.done`),
      content: JSON.stringify([scope, fence.attemptId]),
    };
  };
  async function acquire(fence: AttemptFence, signal: AbortSignal) {
    const paths = names(fence);
    for (;;) {
      signal.throwIfAborted();
      await verify();
      try {
        await mkdir(paths.lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (code(error) !== "EEXIST") throw new UnconfirmedTeardown();
        await delay(25, undefined, { signal });
      }
    }
    await verify();
    await syncDirectory();
    let released = false;
    return {
      async assertOpen() {
        await verify();
        try {
          await lstat(paths.tombstone);
          throw new Error("Sandbox attempt already terminated");
        } catch (error) {
          if (code(error) !== "ENOENT") throw error;
        }
      },
      async terminate() {
        await verify();
        try {
          const fd = await open(paths.tombstone, "wx", 0o600);
          try {
            await fd.writeFile(paths.content);
            await fd.sync();
          } finally {
            await fd.close();
          }
          await syncDirectory();
        } catch (error) {
          if (code(error) !== "EEXIST") throw new UnconfirmedTeardown();
          const info = await lstat(paths.tombstone);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.uid !== Number(initial.uid) ||
            (info.mode & 0o077) !== 0 ||
            (await readFile(paths.tombstone, "utf8")) !== paths.content
          )
            throw new UnconfirmedTeardown();
        }
        await verify();
      },
      async release() {
        if (released) return;
        await verify();
        await rmdir(paths.lock);
        await syncDirectory();
        await verify();
        released = true;
      },
    };
  }
  return { scope, verify, acquire };
}
