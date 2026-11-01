import { expect, it } from "vitest";
import { authPeerRequest, cloudflarePeer, validPeer } from "./peer.ts";
it("strips spoofed forwarding claims and accepts only a validated transport peer", () => {
  const request = new Request("https://auth.example/api/auth/get-session", {
    headers: {
      "x-quorem-peer-ip": "192.0.2.99",
      "x-forwarded-for": "192.0.2.98",
      "cf-connecting-ip": "192.0.2.97",
      forwarded: "for=192.0.2.96",
    },
  });
  const noPeer = authPeerRequest(request, undefined);
  for (const name of ["x-quorem-peer-ip", "x-forwarded-for", "cf-connecting-ip", "forwarded"])
    expect(noPeer.headers.has(name)).toBe(false);
  expect(authPeerRequest(request, "192.0.2.1").headers.get("x-quorem-peer-ip")).toBe("192.0.2.1");
  expect(authPeerRequest(request, "127.0.0.1, 192.0.2.1").headers.has("x-quorem-peer-ip")).toBe(
    false,
  );
  expect(validPeer("::ffff:127.0.0.1")).toBe("::ffff:127.0.0.1");
  expect(cloudflarePeer(request.headers, undefined)).toBeUndefined();
  expect(cloudflarePeer(request.headers, "true")).toBe("192.0.2.97");
  expect(() => cloudflarePeer(request.headers, "invalid")).toThrow();
});
