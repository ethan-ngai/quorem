import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let child: ReturnType<typeof spawn> | undefined;
let stopping = false;
const stop = () => {
  stopping = true;
  child?.kill("SIGKILL");
};
process.stdout.on("error", stop);
process.stdin.on("error", stop);
process.on("disconnect", stop);
process.on("message", stop);
child = spawn(
  process.execPath,
  [fileURLToPath(new URL("./image-child.ts", import.meta.url)), process.argv[2]],
  {
    env: {},
    stdio: ["pipe", "pipe", "ignore"],
  },
);
if (stopping) stop();
process.stdin.pipe(child.stdin!);
child.stdin!.on("error", () => {});
child.stdout!.pipe(process.stdout);
child.on("error", stop);
child.on("close", (code) => {
  if (process.connected) process.disconnect();
  process.exitCode = stopping ? 1 : (code ?? 1);
});
