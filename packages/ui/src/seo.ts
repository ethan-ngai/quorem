/** @file seo.ts @description Shared search and social metadata for static HTML and client navigation. @module site */
export const siteTitle = "Quorem — Coding Practice, Matches & Interviews";
export const siteDescription =
  "Practice coding and SQL, challenge friends in private matches, and run collaborative technical interviews. Go beyond single-step problems with Odyssey.";
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
  "/app": { title: "Quorem Workspace", description: siteDescription },
  "/practice": {
    title: "Coding & SQL Practice — Quorem",
    description:
      "Solve coding and SQL problems in Quorem's browser editor. Test your solutions, explore editorials, and tackle multi-stage Odyssey challenges.",
  },
  "/privacy": {
    title: "Privacy Policy — Quorem",
    description:
      "Learn how Quorem handles account data, code submissions, cookies, and privacy requests.",
  },
  "/terms": {
    title: "Terms of Service — Quorem",
    description:
      "Read the terms for using Quorem's coding practice, private matches, and technical interview workspaces.",
  },
  "/login": {
    title: "Sign In — Quorem",
    description:
      "Sign in to Quorem to practice coding, challenge friends, and manage technical interviews.",
  },
  "/interviews": {
    title: "Technical Interviews — Quorem",
    description:
      "Create and manage collaborative coding interviews with shared editing, test cases, and interviewer-controlled Odyssey stages.",
  },
  "/admin": {
    title: "Question Library — Quorem",
    description: "Create and manage your Quorem coding, SQL, and Odyssey questions.",
  },
  "/match": {
    title: "Private Coding Match — Quorem",
    description:
      "Compete with friends in a private Quorem coding match. Solve the same problem in Showdown or Free-for-all.",
  },
  "/invite": {
    title: "Join a Coding Match — Quorem",
    description:
      "You've been invited to a private coding match on Quorem. Open your invitation to join the challenge.",
  },
  "/interview": {
    title: "Coding Interview — Quorem",
    description:
      "Collaborate in a Quorem technical interview with a shared code editor, test cases, and staged challenges.",
  },
  "/interview-invite": {
    title: "Join a Coding Interview — Quorem",
    description: "Open your Quorem interview invitation to join a collaborative coding workspace.",
  },
};

/** @returns Metadata without private identifiers, invitation tokens or query parameters. */
export function pageSeo(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const section = `/${path.split("/")[1]}`;
  const page =
    pages[path] ??
    (path.startsWith("/practice/")
      ? { title: "Coding Workspace — Quorem", description: pages["/practice"]!.description }
      : pages[section]);
  const indexable = publicPaths.includes(path);
  return {
    ...(page ?? {
      title: "Page not found — Quorem",
      description: "Find your next coding challenge on Quorem.",
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
