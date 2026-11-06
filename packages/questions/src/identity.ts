/** @file identity.ts @description Authored slug budgets and private publication namespaces. @module questions */
const authoredSlugLimit = 80;
const privatePrefix = /^private-[0-9a-f]{16}-/;

/** @returns Whether a draft or namespaced publication fits the shared slug budget. */
export function questionSlugFits(slug: string): boolean {
  const authored = slug.replace(privatePrefix, "");
  return new TextEncoder().encode(authored).length <= authoredSlugLimit;
}

/** @returns The published slug; global clones strip the acting owner's private namespace.
 * @throws When the authored slug has invalid syntax or exceeds its budget.
 */
export async function questionPublicationSlug(
  slug: string,
  privateOwner: string | null,
  namespaceOwner: string | null = privateOwner,
): Promise<string> {
  let prefix = "";
  if (namespaceOwner) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespaceOwner));
    prefix = `private-${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    )
      .join("")
      .slice(0, 16)}-`;
    if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  }
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) ||
    new TextEncoder().encode(slug).length > authoredSlugLimit
  )
    throw new Error(`Choose a valid question slug of at most ${authoredSlugLimit} characters`);
  return (privateOwner ? prefix : "") + slug;
}
