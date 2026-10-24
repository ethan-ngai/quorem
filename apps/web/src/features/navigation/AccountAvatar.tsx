/** @file AccountAvatar.tsx @description Account photos with native text initials as fallback. @module navigation */
import { useState } from "react";
export function avatarIdentity(name?: string, username?: string | null) {
  const label = name?.trim() || username?.trim() || "Guest";
  const initials = (Array.from(label)[0] ?? "G").toLocaleUpperCase();
  return { initials };
}
export function AccountAvatar({
  name,
  username,
  image,
  large = false,
}: {
  name?: string;
  username?: string | null;
  image?: string | null;
  large?: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string>();
  const { initials } = avatarIdentity(name, username);
  return (
    <span className={`account-avatar${large ? " account-avatar-large" : ""}`} aria-hidden="true">
      {image && image !== failedImage ? (
        <img src={image} alt="" onError={() => setFailedImage(image)} />
      ) : (
        <span className="account-avatar-initials">{initials}</span>
      )}
    </span>
  );
}
