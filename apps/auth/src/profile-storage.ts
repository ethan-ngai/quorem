export interface ProfileStorage {
  put(key: string, image: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  remove(key: string): Promise<void>;
}
