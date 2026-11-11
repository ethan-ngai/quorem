/** @file globals.mjs @description Node globals used by Pyright in its browser worker. @module editor */
import { Buffer } from "buffer";
import os from "os";
import process from "process/browser";
import browserOsConstants from "quorem-browser-os-constants";

process.execArgv = [];
process.platform = "unknown";

// Pyright reads Node OS metadata while loading its virtual filesystem.
Object.assign(os, { constants: browserOsConstants, homedir: () => "/" });

export { Buffer, process };
