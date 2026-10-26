/** @file marketing-dev.mjs @description Shared namespace for Astro assets served beside the workspace during development. @module tooling */
export function marketingDevBase(value = "/_marketing") {
  return `${value}/`.replace(/\/+/g, "/");
}

/** Astro emits both unprefixed island URLs and double separators in dev script URLs. */
export function marketingDevHtml(html, base) {
  return html
    .replace(/(["'])\/(src\/|@id\/|@fs\/|node_modules\/)/g, `$1${base}$2`)
    .replaceAll(`${base}/`, base);
}
