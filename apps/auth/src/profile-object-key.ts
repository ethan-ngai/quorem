export const photoPrefix = "/api/auth/profile-photos/";
const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function profilePhotoKey(image: string | null | undefined): string | undefined {
  if (!image?.startsWith(photoPrefix)) return undefined;
  const key = image.slice(photoPrefix.length);
  return keyPattern.test(key) ? key : undefined;
}
export function validPhotoKey(key: string): boolean {
  return keyPattern.test(key);
}

export function photoObjectPath(key: string): string {
  if (!validPhotoKey(key)) throw new Error("Invalid photo key");
  return `avatars/${key}.webp`;
}
