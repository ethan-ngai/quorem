/** @file Standard CodeMirror TypeScript service isolated from the UI thread. */
import { createTypeScriptWorker } from "./typeScriptSemanticTokens";
import { expose } from "comlink";
import { createBrowserTypeScriptEnvironment } from "./browserTypeScriptEnvironment";

expose(createTypeScriptWorker(createBrowserTypeScriptEnvironment));
