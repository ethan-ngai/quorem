import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountAvatar, avatarIdentity } from "./AccountAvatar";
describe("account avatars", () => {
  it("renders the first name letter as native HTML without an image", () => {
    const html = renderToStaticMarkup(<AccountAvatar name="Ethan Ngai" large />);
    expect(html).toContain('class="account-avatar-initials">E</span>');
    expect(html).not.toMatch(/<img|<svg|data:image|background-image/);
  });
  it("uses username when the display name is absent", () => {
    expect(avatarIdentity(" ", "élise").initials).toBe("É");
    expect(avatarIdentity().initials).toBe("G");
  });
  it("uses participant color for initials and a ring only for photos", () => {
    const initials = renderToStaticMarkup(<AccountAvatar name="Alice" color="green" />);
    const photo = renderToStaticMarkup(
      <AccountAvatar name="Alice" color="green" image="/photo" outline />,
    );
    expect(initials).toContain("--avatar-background:green");
    expect(initials).not.toContain("account-avatar-ring");
    expect(photo).toContain("account-avatar-ring");
    expect(photo).toContain("--avatar-background:green");
  });
  it("renders an actual photo only when a URL is set", () => {
    const html = renderToStaticMarkup(
      <AccountAvatar name="Alice" image="/api/auth/profile-photos/example" />,
    );
    expect(html).toContain('<img src="/api/auth/profile-photos/example"');
    expect(html).not.toContain("account-avatar-initials");
  });
});
