/** @file prepare-pages.mjs @description Pages routing and cache policy for the combined static frontend. @module deployment */
import { writeFileSync } from "node:fs";

const directory = "apps/web/dist";
const routes = [
  "practice",
  "match",
  "invite",
  "login",
  "admin",
  "interviews",
  "interview",
  "interview-invite",
];
writeFileSync(
  `${directory}/_redirects`,
  routes.flatMap((route) => [`/${route} /app.html 200`, `/${route}/* /app.html 200`]).join("\n") +
    "\n",
);
writeFileSync(
  `${directory}/_headers`,
  `/*
  X-Quorem-Frontend: Pages
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/_marketing/*
  Cache-Control: public, max-age=31536000, immutable
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// A real 404 prevents Pages' implicit SPA fallback from serving marketing HTML for unknown APIs.
writeFileSync(
  `${directory}/404.html`,
  "<!doctype html><title>Not found</title><h1>Not found</h1>\n",
);
