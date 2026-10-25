/** Ephemeral local fingerprints; clipboard text never enters the event report or storage. */
export function createClipboardProvenance(limit = 20) {
  const fingerprints = new Set<string>();
  let pending = Promise.resolve();
  async function fingerprint(text: string) {
    const bytes = new TextEncoder().encode(text.replace(/\r\n?/g, "\n"));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  return {
    remember(text: string) {
      if (!text || text.length > 1024 * 1024) return pending;
      pending = pending
        .then(async () => {
          const key = await fingerprint(text);
          fingerprints.delete(key);
          fingerprints.add(key);
          while (fingerprints.size > limit)
            fingerprints.delete(fingerprints.values().next().value!);
        })
        .catch(() => {});
      return pending;
    },
    async isInternal(text: string) {
      if (!text || text.length > 1024 * 1024) return false;
      await pending;
      try {
        return fingerprints.has(await fingerprint(text));
      } catch {
        return false;
      }
    },
  };
}
