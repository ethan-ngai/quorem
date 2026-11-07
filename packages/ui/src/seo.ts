/** @file seo.ts @description Shared search and social metadata for static HTML and client navigation. @module site */
export const siteTitle = "Quorem - Competitive Coding and Practice";
export const siteDescription =
  "Challenge friends in Showdown and Free-for-all coding matches. Practice coding problems at your own pace and tackle multi-stage Odyssey challenges.";
export const socialImage = "/social-preview.jpg";
export const socialImageAlt =
  "Quorem dark hero: pixel logo and wordmark beside a Python coding workspace. Compete beyond the algorithm.";
export const publicPaths = ["/", "/practice", "/privacy", "/terms"];

const pages: Record<string, { title: string; description: string }> = {
  "/": { title: siteTitle, description: siteDescription },
  "/practice": {
    title: "Coding Practice - Quorem",
    description:
      "Browse coding problems by topic and difficulty. Run test cases in the editor and work through multi-stage Odyssey challenges at your own pace.",
  },
  "/practice/:slug": {
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
      "Sign in or create a Quorem account to join coding matches, host a lobby and save your practice progress.",
  },
  "/interviews": {
    title: "Interviews - Quorem",
    description: "Create sessions, invite participants and manage collaborative coding workspaces.",
  },
  "/admin": {
    title: "Admin Dashboard - Quorem",
    description: "Review platform activity, accounts and question content.",
  },
  "/questions": {
    title: "Question Editor - Quorem",
    description:
      "Create and edit coding questions, define test cases and build multi-stage Odyssey challenges.",
  },
  "/party": {
    title: "Match Lobby - Quorem",
    description: "Invite players, choose a coding question and configure your next private match.",
  },
  "/match/:id": {
    title: "Coding Match - Quorem",
    description:
      "Write and test your solution in a competitive Showdown, Free-for-all or Factions match.",
  },
  "/match/:id/review": {
    title: "Match Review - Quorem",
    description: "Revisit the question and review submissions from a completed coding match.",
  },
  "/invite/:token": {
    title: "Join a Coding Match - Quorem",
    description:
      "Accept your invitation to join a private Quorem lobby and get ready for the next coding match.",
  },
  "/interview/:id": {
    title: "Coding Interview - Quorem",
    description:
      "Collaborate in a shared code editor, run test cases and work through staged coding challenges.",
  },
  "/interview-invite/:token": {
    title: "Join a Coding Interview - Quorem",
    description: "Open your invitation to join a shared coding workspace.",
  },
};

export const appPaths = Object.keys(pages).filter((path) => path !== "/");
const dynamicPages = appPaths
  .filter((path) => path.includes("/:"))
  .map((path) => [path, new RegExp(`^${path.replace(/:\w+/g, "[^/]+")}$`)] as const);

/** @returns Metadata without private identifiers, invitation tokens or query parameters. */
export function pageSeo(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "").toLowerCase() || "/";
  const route = dynamicPages.find(([, pattern]) => pattern.test(path))?.[0] ?? path;
  const page = pages[route];
  const canonicalPath = publicPaths.find((publicPath) => publicPath === path);
  return {
    ...(page ?? {
      title: "Page not found - Quorem",
      description: "This page could not be found. Return to practice or start a match on Quorem.",
    }),
    canonicalPath,
    route: page ? route : undefined,
    indexable: !!canonicalPath,
    robots: canonicalPath ? "index, follow, max-image-preview:large" : "noindex, follow",
  };
}

/** @returns The generated HTML shell's basename for an app route. */
export function routeSeoFile(route: string) {
  return `route-${route.slice(1).replace(/\/:?/g, "-")}`;
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
  if (page.canonicalPath) {
    const url = new URL(page.canonicalPath, origin).href;
    tags.push(
      `<link rel="canonical" href="${escapeHtml(url)}" />`,
      `<meta property="og:url" content="${escapeHtml(url)}" />`,
    );
  }
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
