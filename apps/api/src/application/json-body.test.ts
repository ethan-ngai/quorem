/** @file json-body.test.ts @description Shared request body bounds. @module api */
import { expect, test } from "vitest";
import { jsonObjectBody } from "./json-body.ts";
const request = (body: BodyInit | null) =>
  new Request("http://localhost", { method: "POST", body });
test("bounds bytes and preserves explicit empty policy", async () => {
  await expect(jsonObjectBody(request(null), 4)).rejects.toMatchObject({ status: 400 });
  await expect(jsonObjectBody(request(null), 4, { emptyObject: true })).resolves.toEqual({});
  await expect(jsonObjectBody(request('{"x":"λ"}'), 8)).rejects.toMatchObject({ status: 413 });
  await expect(jsonObjectBody(request(new Uint8Array([123, 255, 125])), 8)).rejects.toMatchObject({
    status: 400,
  });
  await expect(jsonObjectBody(request("[]"), 8)).rejects.toMatchObject({ status: 400 });
});
