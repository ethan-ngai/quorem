import { describe, expect, it } from "vitest";
import { IdentityError } from "./model.ts";
import { reauthorizeGrant, type GrantReaders, type ManagedGrant } from "./grant.ts";

const grant: ManagedGrant = {
  kind: "managed",
  issuer: "issuer",
  subject: "subject",
  sessionId: "session",
  expiresAt: 2000,
  strongUntil: 1599,
};
const principal = {
  kind: "managed" as const,
  userId: "u",
  displayName: "U",
  admin: false,
  emailVerified: true,
  sessionId: "session",
  credentialExpiresAt: 3000,
  strongUntil: 0,
};
const readers: GrantReaders = {
  sessions: { check: async () => ({ strongAt: 999 }) },
  managed: async () => principal,
  guest: async () => null,
};
describe("verified grants", () => {
  it("caps expiry and derives fresh strong authority", async () => {
    expect(await reauthorizeGrant(grant, readers, 1000000)).toMatchObject({
      credentialExpiresAt: 2000,
      strongUntil: 1599,
    });
  });
  it("rejects expiry and rotated sessions", async () => {
    await expect(reauthorizeGrant(grant, readers, 2000000)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    await expect(
      reauthorizeGrant(
        grant,
        { ...readers, managed: async () => ({ ...principal, sessionId: "other" }) },
        1000000,
      ),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("preserves outage classification and rejects unauthorized guests", async () => {
    await expect(
      reauthorizeGrant(
        grant,
        {
          ...readers,
          managed: async () => {
            throw Error("outage");
          },
        },
        1000000,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
    await expect(
      reauthorizeGrant(
        { kind: "guest", scope: "match", resourceId: "one", hash: "hash", expiresAt: 2000 },
        readers,
        1000000,
      ),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("reauthorizes a party guest using its party binding", async () => {
    const partyGuest = {
      kind: "guest" as const,
      userId: "g",
      displayName: "G",
      admin: false as const,
      emailVerified: false as const,
      sessionId: "hash",
      strongUntil: 0 as const,
      credentialExpiresAt: 3000,
      scope: { kind: "party" as const, partyId: "one" },
    };
    const partyReaders: GrantReaders = {
      ...readers,
      guest: async (kind) => (kind === "match" ? partyGuest : null),
    };
    const partyGrant = {
      kind: "guest" as const,
      scope: "party" as const,
      resourceId: "one",
      hash: "hash",
      expiresAt: 2000,
    };
    expect(await reauthorizeGrant(partyGrant, partyReaders, 1000000)).toMatchObject({
      scope: partyGuest.scope,
    });
    await expect(
      reauthorizeGrant({ ...partyGrant, resourceId: "other" }, partyReaders, 1000000),
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("never upgrades strong authority beyond the original grant", async () => {
    expect(await reauthorizeGrant({ ...grant, strongUntil: 0 }, readers, 1000000)).toMatchObject({
      strongUntil: 0,
    });
    expect(await reauthorizeGrant({ ...grant, strongUntil: 1200 }, readers, 1000000)).toMatchObject(
      { strongUntil: 1200 },
    );
  });
});
