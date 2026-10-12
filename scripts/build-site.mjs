/** Build the static homepage and workspace into one deployment artifact. */
import { execFileSync } from "node:child_process";
import { cpSync, renameSync } from "node:fs";

execFileSync("vp", ["-C", "apps/web", "build"], { stdio: "inherit" });
execFileSync("vp", ["-C", "apps/marketing", "run", "build"], { stdio: "inherit" });
renameSync("apps/web/dist/index.html", "apps/web/dist/app.html");
cpSync("apps/marketing/dist", "apps/web/dist", { recursive: true });
