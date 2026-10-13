import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountAvatar, avatarIdentity } from "./AccountAvatar";
describe("account avatars", () => {
  it("renders name-derived initials as native HTML without an image", () => {
    const html = renderToStaticMarkup(<AccountAvatar name="Ethan Ngai" large />);
    expect(html).toContain('class="account-avatar-initials">EN</span>');
    expect(html).not.toMatch(/<img|<svg|data:image|background-image/);
  });
  it("uses username when the display name is absent and keeps a stable tone", () => {
    expect(avatarIdentity(" ", "élise").initials).toBe("ÉL");
    expect(avatarIdentity("Alice Jones", "alice").tone).toBe(
      avatarIdentity("Alice Smith", "alice").tone,
    );
    expect(avatarIdentity().initials).toBe("GU");
  });
  it("renders an actual photo only when a URL is set", () => {
    const html = renderToStaticMarkup(
      <AccountAvatar name="Alice" image="/api/auth/profile-photos/example" />,
    );
    expect(html).toContain('<img src="/api/auth/profile-photos/example"');
    expect(html).not.toContain("account-avatar-initials");
  });
});
