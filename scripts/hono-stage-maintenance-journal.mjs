/** Private append-only operator evidence; persist operation IDs before remote mutation. */
import { open, lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { constants } from "node:fs";

export async function maintenanceJournal(directory, plan) {
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
    throw new Error("Private maintenance directory required");
  const serialized = JSON.stringify(plan);
  const digest = createHash("sha256").update(serialized).digest("hex");
  const filename = join(directory, "plan.json");
  let file;
  try {
    file = await open(filename, "wx", 0o600);
    await file.writeFile(serialized);
    await file.sync();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const saved = await lstat(filename);
    if (!saved.isFile() || saved.isSymbolicLink() || (saved.mode & 0o077) !== 0)
      throw new Error("Private maintenance plan required");
    if ((await readFile(filename, "utf8")) !== serialized)
      throw new Error("Maintenance plan changed; use its persisted operation IDs");
  } finally {
    await file?.close();
  }
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return {
    digest,
    async record(event, evidence) {
      if (!/^[a-z][a-z-]{0,47}$/.test(event)) throw new Error("Invalid maintenance event");
      const body = JSON.stringify({ plan: digest, event, evidence });
      if (Buffer.byteLength(body) > 65536) throw new Error("Maintenance evidence too large");
      // A failed append prevents the next phase; partial final lines never authorize resume.
      const handle = await open(
        join(directory, "events.ndjson"),
        constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || (stat.mode & 0o077) !== 0)
          throw new Error("Private maintenance evidence required");
        await handle.writeFile(`${body}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
}
