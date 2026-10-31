import type { ProfileStorage } from "../profile-storage.ts";
import { photoObjectPath } from "../profile-object-key.ts";

export interface ProfileBucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}
export function r2BindingProfileStorage(bucket: ProfileBucket): ProfileStorage {
  return {
    async put(key, image) {
      if (image.byteLength > 5 * 1024 * 1024) throw new Error("Photo too large");
      await bucket.put(photoObjectPath(key), image);
    },
    async get(key) {
      const object = await bucket.get(photoObjectPath(key));
      if (!object) return undefined;
      if (object.size > 5 * 1024 * 1024) throw new Error("Photo too large");
      const data = new Uint8Array(await object.arrayBuffer());
      if (data.byteLength > 5 * 1024 * 1024) throw new Error("Photo too large");
      return data;
    },
    async remove(key) {
      await bucket.delete(photoObjectPath(key));
    },
  };
}
