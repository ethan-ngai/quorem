import { sha256 } from "../../sha256";
/** Ephemeral local fingerprints; clipboard text never enters the event report or storage. */
export function createClipboardProvenance(limit = 20) {
  const fingerprints = new Set<string>();
  let pending = Promise.resolve();
  const fingerprint = (text: string) => sha256(text.replace(/\r\n?/g, "\n"));
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
