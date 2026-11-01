import type { ProfileStorage } from "../profile-storage.ts";

export interface ProfileBucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}
export function r2BindingProfileStorage(bucket: ProfileBucket): ProfileStorage {
  const path = (key: string) => {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key))
      throw new Error("Invalid photo key");
    return `avatars/${key}.webp`;
  };
  return {
    async put(key, image) {
      if (image.byteLength > 5 * 1024 * 1024) throw new Error("Photo too large");
      await bucket.put(path(key), image);
    },
    async get(key) {
      const object = await bucket.get(path(key));
      if (!object) return undefined;
      if (object.size > 5 * 1024 * 1024) throw new Error("Photo too large");
      const data = new Uint8Array(await object.arrayBuffer());
      if (data.byteLength > 5 * 1024 * 1024) throw new Error("Photo too large");
      return data;
    },
    async remove(key) {
      await bucket.delete(path(key));
    },
  };
}
