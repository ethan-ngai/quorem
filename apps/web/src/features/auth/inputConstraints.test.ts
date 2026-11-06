import { describe, expect, it } from "vitest";
import { authInputConstraints } from "./inputConstraints";

describe("auth input constraints", () => {
  it("allows incomplete emails and usernames without accepting invalid characters", () => {
    expect(authInputConstraints.email.edit("user@exam")).toBe(true);
    expect(authInputConstraints.email.edit("user name@example.com")).toBe(false);
    expect(authInputConstraints.username.edit("alice1")).toBe(true);
    expect(authInputConstraints.username.edit("alice-1")).toBe(false);
  });

  it("preserves password whitespace while limiting length", () => {
    expect(authInputConstraints.password.edit(" secret ! ")).toBe(true);
    expect(authInputConstraints.password.edit("x".repeat(129))).toBe(false);
  });

  it("accepts partial six digit verification codes", () => {
    expect(authInputConstraints.code.edit("0012")).toBe(true);
    expect(authInputConstraints.code.edit("12a")).toBe(false);
    expect(authInputConstraints.code.edit("1234567")).toBe(false);
    expect(authInputConstraints.code.schema.safeParse("001234").success).toBe(true);
  });
});

it("blocks impossible email prefixes while retaining incomplete valid domains", () => {
  for (const source of [".name", "name..x", "name@@", "name@-", "name@host_", "name.@host"])
    expect(authInputConstraints.email.edit(source)).toBe(false);
  for (const source of ["", "name", "name@", "name@host-", "name@host.", "name@host.com"])
    expect(authInputConstraints.email.edit(source)).toBe(true);
  expect(authInputConstraints.email.schema.safeParse("name@").success).toBe(false);
});
