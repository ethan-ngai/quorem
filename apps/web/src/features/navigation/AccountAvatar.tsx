/** @file AccountAvatar.tsx @description Account photos with native text initials as fallback. @module navigation */
import { useState, type CSSProperties } from "react";
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
  color,
  outline = false,
}: {
  name?: string;
  username?: string | null;
  image?: string | null;
  large?: boolean;
  color?: string;
  outline?: boolean;
}) {
  const [failedImage, setFailedImage] = useState<string>();
  const { initials } = avatarIdentity(name, username);
  const hasImage = !!image && image !== failedImage;
  return (
    <span
      className={`account-avatar${large ? " account-avatar-large" : ""}${color && hasImage && outline ? " account-avatar-ring" : ""}`}
      style={
        color
          ? ({ "--avatar-background": color, "--avatar-foreground": "white" } as CSSProperties)
          : undefined
      }
      aria-hidden="true"
    >
      {hasImage ? (
        <img src={image} alt="" onError={() => setFailedImage(image)} />
      ) : (
        <span className="account-avatar-initials">{initials}</span>
      )}
    </span>
  );
}
