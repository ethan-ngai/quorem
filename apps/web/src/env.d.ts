/** @file env.d.ts @description Declares the optional browser API base URL. @module web */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
