/** @file seo.ts @description Shared search and social metadata for static HTML and client navigation. @module site */
export const siteTitle = "Quorem - Compete Beyond the Algorithm";
export const siteDescription =
  "Challenge friends in private coding matches. Go head-to-head in Showdown or compete with a group in Free-for-all. First correct submission wins.";
export const socialImage = "/social-preview.jpg";
export const socialImageAlt =
  "Quorem dark hero: pixel logo and wordmark beside a Python coding workspace. Compete beyond the algorithm.";
export const publicPaths = ["/", "/practice", "/privacy", "/terms"];
export const appPaths = [
  "/practice",
  "/privacy",
  "/terms",
  "/login",
  "/interviews",
  "/admin",
  "/match",
  "/invite",
  "/interview",
  "/interview-invite",
];

const pages: Record<string, { title: string; description: string }> = {
  "/": { title: siteTitle, description: siteDescription },
  "/app": {
    title: "Workspace - Quorem",
    description: "Write, run and test your code in your Quorem workspace.",
  },
  "/practice": {
    title: "Practice - Quorem",
    description:
      "Sharpen your skills between matches. Solve coding problems, test your solutions and tackle multi-stage Odyssey challenges.",
  },
  "/practice/workspace": {
    title: "Practice Workspace - Quorem",
    description:
      "Work through the problem, write your solution and run test cases in Quorem's coding editor.",
  },
  "/privacy": {
    title: "Privacy Policy - Quorem",
    description:
      "Learn how Quorem handles account data, code submissions, cookies and privacy requests.",
  },
  "/terms": {
    title: "Terms of Service - Quorem",
    description:
      "Read the terms for using Quorem, including account responsibilities, fair play and acceptable use.",
  },
  "/login": {
    title: "Sign In - Quorem",
    description:
      "Sign in to join matches, create a lobby and keep your coding practice in one place.",
  },
  "/interviews": {
    title: "Interviews - Quorem",
    description: "Create sessions, invite participants and manage collaborative coding workspaces.",
  },
  "/admin": {
    title: "Question Editor - Quorem",
    description:
      "Create and edit coding questions, define test cases and build multi-stage Odyssey challenges.",
  },
  "/match": {
    title: "Coding Match - Quorem",
    description:
      "Compete in Showdown or Free-for-all. Write your solution, test it and race to the first correct submission.",
  },
  "/invite": {
    title: "Join a Coding Match - Quorem",
    description:
      "Accept your match invitation, join the lobby and get ready to compete in Showdown or Free-for-all.",
  },
  "/interview": {
    title: "Coding Interview - Quorem",
    description:
      "Collaborate in a shared code editor, run test cases and work through staged coding challenges.",
  },
  "/interview-invite": {
    title: "Join a Coding Interview - Quorem",
    description: "Open your invitation to join a shared coding workspace.",
  },
};

/** @returns Metadata without private identifiers, invitation tokens or query parameters. */
export function pageSeo(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const section = `/${path.split("/")[1]}`;
  const page =
    pages[path] ?? (path.startsWith("/practice/") ? pages["/practice/workspace"] : pages[section]);
  const indexable = publicPaths.includes(path);
  return {
    ...(page ?? {
      title: "Page not found - Quorem",
      description: "This page could not be found. Return to practice or start a match on Quorem.",
    }),
    path,
    indexable,
    robots: indexable ? "index, follow, max-image-preview:large" : "noindex, follow",
  };
}

/** @returns Escaped HTML attribute or text value. */
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

/** @returns Search and sharing tags; the origin comes from deployment configuration. */
export function seoMarkup(pathname: string, origin = "https://quorem.app") {
  const page = pageSeo(pathname);
  const url = new URL(page.path, origin).href;
  const image = new URL(socialImage, origin).href;
  const tags = [
    `<title>${escapeHtml(page.title)}</title>`,
    ...Object.entries({
      description: page.description,
      robots: page.robots,
      "twitter:card": "summary_large_image",
      "twitter:title": page.title,
      "twitter:description": page.description,
      "twitter:image": image,
      "twitter:image:alt": socialImageAlt,
    }).map(([name, content]) => `<meta name="${name}" content="${escapeHtml(content)}" />`),
    ...Object.entries({
      "og:type": "website",
      "og:site_name": "Quorem",
      "og:locale": "en_US",
      "og:title": page.title,
      "og:description": page.description,
      "og:image": image,
      "og:image:type": "image/jpeg",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": socialImageAlt,
    }).map(
      ([property, content]) => `<meta property="${property}" content="${escapeHtml(content)}" />`,
    ),
  ];
  if (page.indexable)
    tags.push(
      `<link rel="canonical" href="${escapeHtml(url)}" />`,
      `<meta property="og:url" content="${escapeHtml(url)}" />`,
    );
  return `<!-- seo:start -->\n${tags.join("\n")}\n<!-- seo:end -->`;
}

/** @returns Public brand entities, without unverified ratings or pricing claims. */
export function siteSchema(origin = "https://quorem.app") {
  const url = new URL("/", origin).href;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}#organization`,
        name: "Quorem",
        url,
        logo: new URL("/icon-512.png", origin).href,
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: "Quorem",
        url,
        description: siteDescription,
        inLanguage: "en",
        publisher: { "@id": `${url}#organization` },
      },
    ],
  }).replace(/</g, "\\u003c");
}
