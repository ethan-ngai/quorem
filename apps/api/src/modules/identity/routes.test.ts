import { expect, it } from "vitest";
import { IdentityError } from "./model.ts";
import { GuestOriginDenied } from "./guest/credentials.ts";
import { identifyRequest, mapIdentityError } from "./routes.ts";
it("maps identity failures consistently while retaining internal cause", async () => {
  for (const [cause, status] of [
    [new IdentityError("unauthorized"), 401],
    [new IdentityError("unavailable"), 503],
    [new GuestOriginDenied(), 403],
  ] as const) {
    expect(mapIdentityError(cause)).toMatchObject({ status, cause });
    await expect(
      identifyRequest(async () => {
        throw cause;
      }, new Request("https://example.test")),
    ).rejects.toMatchObject({ status, cause });
  }
});
