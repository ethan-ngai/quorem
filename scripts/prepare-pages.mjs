/** @file prepare-pages.mjs @description Pages routing and cache policy for the combined static frontend. @module deployment */
import { readFileSync, writeFileSync } from "node:fs";

const directory = "apps/web/dist";
const routes = [
  "privacy",
  "terms",
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
  routes.flatMap((route) => [`/${route} /app 200`, `/${route}/* /app 200`]).join("\n") + "\n",
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
// Keep Pages' HTTP 404 status while booting the app's shared recovery screen.
writeFileSync(
  `${directory}/404.html`,
  readFileSync(`${directory}/app.html`, "utf8").replace(
    "<title>Quorem · Practice</title>",
    "<title>Page not found · Quorem</title>",
  ),
);
