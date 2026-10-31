import { profilePhotoKey } from "./profile-object-key.ts";
import type { ProfileStorage } from "./profile-storage.ts";

export interface PhotoReferencePage {
  rows: { id: string; image: string | null }[];
  next: string | undefined;
}
export interface PhotoCutoverDestination {
  get: ProfileStorage["get"];
  putIfAbsent(key: string, bytes: Uint8Array): Promise<boolean>;
}
export type PhotoCutoverResult = {
  checked: number;
  missing: number;
  copied: number;
  next: string | undefined;
  complete: boolean;
  cutoverReady: false;
};

/** A page never holds a database connection during object-store operations. */
export async function copyProfilePhotoPage(options: {
  references: (cursor: string | undefined, limit: number) => Promise<PhotoReferencePage>;
  source: Pick<ProfileStorage, "get">;
  destination: PhotoCutoverDestination;
  digest: (value: Uint8Array) => Promise<string>;
  cursor?: string;
  limit: number;
  apply: boolean;
}): Promise<PhotoCutoverResult> {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 64)
    throw new Error("Invalid page limit");
  const page = await options.references(options.cursor, options.limit);
  if (page.rows.length > options.limit) throw new Error("Invalid reference page");
  let checked = 0,
    missing = 0,
    copied = 0;
  for (const row of page.rows) {
    const key = profilePhotoKey(row.image);
    if (!key) continue;
    const source = await options.source.get(key);
    if (!source) throw new Error("Referenced source photo unavailable");
    const hash = await options.digest(source);
    let target = await options.destination.get(key);
    if (!target) {
      missing++;
      if (!options.apply) {
        checked++;
        continue;
      }
      const created = await options.destination.putIfAbsent(key, source);
      target = await options.destination.get(key);
      if (!target) throw new Error("Destination photo unavailable after write");
      if (created) copied++;
    }
    if ((await options.digest(target)) !== hash) throw new Error("Destination photo mismatch");
    checked++;
  }
  return {
    checked,
    missing,
    copied,
    next: page.next,
    complete: page.next === undefined,
    cutoverReady: false,
  };
}
