/// <reference types="vite-plus/client" />
/** @file env.d.ts @description Declares browser development service URLs. @module web */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_LANGUAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module "*.css";
