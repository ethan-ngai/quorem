/** @file Standard CodeMirror TypeScript service isolated from the UI thread. */
import { createWorker } from "@valtown/codemirror-ts/worker";
import { expose } from "comlink";
import { createBrowserTypeScriptEnvironment } from "./browserTypeScriptEnvironment";

expose(createWorker(createBrowserTypeScriptEnvironment));
