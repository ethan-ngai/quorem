/** @file AccountAvatar.tsx @description Account photos with native text initials as fallback. @module navigation */
import { useState } from "react";
export function avatarIdentity(name?: string, username?: string | null) {
  const label = name?.trim() || username?.trim() || "Guest";
  const words = label.split(/\s+/u);
  const initials = (
    words.length > 1
      ? `${Array.from(words[0]!)[0]}${Array.from(words.at(-1)!)[0]}`
      : Array.from(label).slice(0, 2).join("")
  ).toLocaleUpperCase();
  const tone =
    Array.from(username || label).reduce(
      (hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0,
      0,
    ) % 4;
  return { initials, tone };
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
  const { initials, tone } = avatarIdentity(name, username);
  return (
    <span
      className={`account-avatar account-avatar-tone-${tone}${large ? " account-avatar-large" : ""}`}
      aria-hidden="true"
    >
      {image && image !== failedImage ? (
        <img src={image} alt="" onError={() => setFailedImage(image)} />
      ) : (
        <span className="account-avatar-initials">{initials}</span>
      )}
    </span>
  );
}
