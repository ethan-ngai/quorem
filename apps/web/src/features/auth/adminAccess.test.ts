/** @file adminAccess.test.ts @description Admin route admission and sign-in recovery. @module auth */
import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdminAccess, requireAdminSession } from "./adminAccess";
import { resetToken, type Session } from "./session";

const admin: Session = {
  mode: "managed",
  kind: "account",
  user: { id: "admin", displayName: "Admin", emailVerified: true, role: "admin" },
};
afterEach(() => {
  resetToken();
  vi.unstubAllGlobals();
});
function rejection(run: () => void) {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected route admission to fail");
}
describe("admin admission", () => {
  it.each([
    "/admin",
    "/admin/users?status=active#recent",
    "/questions?section=drafts&draft=example#cases",
  ])("sends anonymous visitors to sign-in with the complete destination: %s", (href) => {
    const error = rejection(() => requireAdminSession(null, href));
    expect(isRedirect(error)).toBe(true);
    expect(error).toMatchObject({
      options: { href: `/login?${new URLSearchParams({ returnTo: href })}`, replace: true },
    });
  });
  it("requires account sign-in for guests", () => {
    expect(
      isRedirect(rejection(() => requireAdminSession({ ...admin, kind: "guest" }, "/admin"))),
    ).toBe(true);
  });
  it("conceals admin pages from non-admin accounts", () => {
    expect(
      isNotFound(
        rejection(() =>
          requireAdminSession({ ...admin, user: { ...admin.user, role: "user" } }, "/admin"),
        ),
      ),
    ).toBe(true);
  });
  it("allows explicitly entitled authors only into authoring", () => {
    const author: Session = {
      ...admin,
      user: { ...admin.user, role: "user" },
      capabilities: {
        hostGuests: false,
        authorCustomQuestions: true,
        interviewConcurrency: 1,
        interviews: false,
        hostedIntelligence: false,
        experimental: false,
        guestConcurrency: 0,
      },
    };
    expect(() => requireAdminSession(author, "/questions", "authoring")).not.toThrow();
    expect(isNotFound(rejection(() => requireAdminSession(author, "/admin")))).toBe(true);
    expect(
      isNotFound(
        rejection(() =>
          requireAdminSession({ ...author, capabilities: undefined }, "/questions", "authoring"),
        ),
      ),
    ).toBe(true);
  });
  it("admits admins", () => {
    expect(() => requireAdminSession(admin, "/admin")).not.toThrow();
  });
  it("checks current permissions instead of trusting a cached admin role", async () => {
    const cache = new QueryClient();
    cache.setQueryData(["auth-session"], admin);
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | Request) =>
        typeof input === "string"
          ? new Response(null, { status: 401 })
          : Response.json({ ...admin, user: { ...admin.user, role: "user" } }),
      ),
    );
    await expect(requireAdminAccess(cache, "/admin")).rejects.toSatisfy(isNotFound);
  });
  it("keeps session outages as recoverable errors", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(requireAdminAccess(new QueryClient(), "/admin")).rejects.toThrow(
      "Account temporarily unavailable",
    );
  });
});
