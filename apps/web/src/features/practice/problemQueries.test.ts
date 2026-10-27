import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { DevelopmentIdentity, ProblemVersion } from "@quorem/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../../fixtures/problems/run-widths.json";
import { publicApi } from "../../api/client";
import { catalogQueryOptions, catalogFacets, problemQueryOptions } from "./problemQueries";

const auth = vi.hoisted(() => ({ actor: "account-a", calls: 0 }));
vi.mock("../auth/session", () => ({
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => {
    auth.calls++;
    const request = new Request(input, init);
    request.headers.set("Authorization", `Bearer ${auth.actor}`);
    request.headers.delete("X-Dev-User");
    return fetch(request);
  },
}));

const publicProblem = {
  ...fixture.problem,
  id: "public-version",
  slug: "public-question",
} as ProblemVersion;
const privateProblem = {
  ...publicProblem,
  id: "private-version",
  slug: "private-question",
  title: "Private account A content",
};
const actor = (value: string) => value as DevelopmentIdentity;
const clients: QueryClient[] = [];
let requests: Request[];
const client = () => {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);
  return value;
};
const page = (items: ProblemVersion[]) => ({
  items,
  topics: ["arrays", "strings"],
  companies: [],
  total: items.length,
  page: 1,
  limit: 20,
});

beforeEach(() => {
  auth.actor = "account-a";
  auth.calls = 0;
  requests = [];
  vi.stubGlobal("window", { location: { origin: "https://fixture.invalid" } });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === "/v1/problems") {
        const personalized =
          url.searchParams.get("library") !== "global" &&
          request.headers.get("Authorization") === "Bearer account-a";
        return Promise.resolve(
          Response.json(page(personalized ? [publicProblem, privateProblem] : [publicProblem])),
        );
      }
      if (url.pathname.endsWith("/private-question")) {
        return Promise.resolve(
          request.headers.get("Authorization") === "Bearer account-a"
            ? Response.json(privateProblem)
            : Response.json({ error: { code: "not_found" } }, { status: 404 }),
        );
      }
      return Promise.resolve(Response.json(publicProblem));
    }),
  );
});
afterEach(() => {
  for (const value of clients.splice(0)) value.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads one public catalog before identity and reuses it for a resolved anonymous viewer", async () => {
  const cache = client();
  const first = await cache.fetchQuery(catalogQueryOptions(cache, undefined, {}));
  const next = await cache.fetchQuery(catalogQueryOptions(cache, "anonymous", {}));
  expect(next).toEqual(first);
  expect(requests).toHaveLength(1);
  expect(auth.calls).toBe(0);
  expect(new URL(requests[0]!.url).searchParams.get("library")).toBe("global");
  expect(requests[0]!.credentials).toBe("omit");
  expect(requests[0]!.headers.get("Authorization")).toBeNull();
  expect(catalogFacets(cache, "anonymous", { q: "different filter" }).topics).toEqual([
    "arrays",
    "strings",
  ]);
});

it("strips supplied credentials from the explicit public transport", async () => {
  await publicApi().GET("/v1/problems", {
    params: { query: { library: "global" } },
    headers: {
      Authorization: "Bearer supplied",
      Cookie: "fixture=credential",
      "X-Dev-User": "alice",
    },
  });
  expect(auth.calls).toBe(0);
  expect(requests[0]!.credentials).toBe("omit");
  for (const name of ["Authorization", "Cookie", "X-Dev-User"])
    expect(requests[0]!.headers.get(name)).toBeNull();
});

it("does not request a private library until identity resolves", async () => {
  const cache = client();
  const observer = new QueryObserver(
    cache,
    catalogQueryOptions(cache, undefined, { library: "private" }),
  );
  const stop = observer.subscribe(() => {});
  await Promise.resolve();
  expect(requests).toHaveLength(0);
  expect(observer.getCurrentResult().data).toBeUndefined();
  observer.setOptions(catalogQueryOptions(cache, actor("account-a"), { library: "private" }));
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  expect(requests).toHaveLength(1);
  expect(requests[0]!.headers.get("Authorization")).toBe("Bearer account-a");
  stop();
});

it("opens catalog questions without a second detail GET or any workspace mutation", async () => {
  const cache = client();
  await cache.fetchQuery(catalogQueryOptions(cache, actor("account-a"), {}));
  const result = await cache.fetchQuery(
    problemQueryOptions(cache, actor("account-a"), privateProblem.slug),
  );
  expect(result.title).toBe(privateProblem.title);
  expect(requests).toHaveLength(1);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

it("never shares private catalog details with another account or the public cache", async () => {
  const cache = client();
  await cache.fetchQuery(catalogQueryOptions(cache, actor("account-a"), { library: "private" }));
  expect(
    cache.getQueryData(problemQueryOptions(cache, "anonymous", privateProblem.slug).queryKey),
  ).toBeUndefined();
  auth.actor = "account-b";
  await expect(
    cache.fetchQuery(problemQueryOptions(cache, actor("account-b"), privateProblem.slug)),
  ).rejects.toThrow();
  expect(
    cache.getQueryData(
      problemQueryOptions(cache, actor("account-a"), privateProblem.slug).queryKey,
    ),
  ).toEqual(privateProblem);
  await expect(
    cache.fetchQuery(problemQueryOptions(cache, "anonymous", privateProblem.slug)),
  ).rejects.toThrow();
});

it("can reuse a proven public question when the account resolves", async () => {
  const cache = client();
  await cache.fetchQuery(catalogQueryOptions(cache, undefined, {}));
  const result = await cache.fetchQuery(
    problemQueryOptions(cache, actor("account-a"), publicProblem.slug),
  );
  expect(result).toEqual(publicProblem);
  expect(requests).toHaveLength(1);
});

it("does not replace a newer detail response with an older in-flight catalog snapshot", async () => {
  const cache = client();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const catalog = cache.fetchQuery(catalogQueryOptions(cache, "anonymous", {}));
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  clock.mockReturnValue(2000);
  const options = problemQueryOptions(cache, "anonymous", publicProblem.slug);
  cache.setQueryData(options.queryKey, { ...publicProblem, title: "Newer detail" });
  clock.mockReturnValue(3000);
  release(Response.json(page([publicProblem])));
  await catalog;
  expect(cache.getQueryData<ProblemVersion>(options.queryKey)?.title).toBe("Newer detail");
});

it("never uses another user's rows as a personalization or private-library placeholder", async () => {
  const cache = client();
  await cache.fetchQuery(catalogQueryOptions(cache, "anonymous", {}));
  await cache.fetchQuery(catalogQueryOptions(cache, actor("account-a"), { library: "private" }));
  auth.actor = "account-b";
  const personalized = new QueryObserver(cache, catalogQueryOptions(cache, actor("account-b"), {}));
  expect(personalized.getCurrentResult().data?.items).toEqual([publicProblem]);
  const privateLibrary = new QueryObserver(
    cache,
    catalogQueryOptions(cache, actor("account-b"), { library: "private" }),
  );
  expect(privateLibrary.getCurrentResult().data).toBeUndefined();
});

it("does not initialize a newly resolved account from expired public details", async () => {
  const cache = client();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  await cache.fetchQuery(catalogQueryOptions(cache, "anonymous", {}));
  clock.mockReturnValue(32_000);
  const options = problemQueryOptions(cache, actor("account-a"), publicProblem.slug);
  expect(options.initialData).toBeUndefined();
  await cache.fetchQuery(options);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.headers.get("Authorization")).toBe("Bearer account-a");
});

it("resolves a signed-out private library empty without contacting an implicitly privileged local server", async () => {
  const cache = client();
  const inheritedOwnerFetch = vi.fn(() => Promise.resolve(Response.json(page([privateProblem]))));
  vi.stubGlobal("fetch", inheritedOwnerFetch);
  const observer = new QueryObserver(
    cache,
    catalogQueryOptions(cache, undefined, { library: "private" }),
  );
  const stop = observer.subscribe(() => {});
  expect(observer.getCurrentResult().data).toBeUndefined();
  expect(inheritedOwnerFetch).not.toHaveBeenCalled();
  observer.setOptions(catalogQueryOptions(cache, "anonymous", { library: "private" }));
  await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
  expect(observer.getCurrentResult().data).toEqual({
    items: [],
    topics: [],
    companies: [],
    total: 0,
    page: 1,
    limit: 20,
  });
  expect(inheritedOwnerFetch).not.toHaveBeenCalled();
  expect(auth.calls).toBe(0);
  expect(
    cache.getQueryData(problemQueryOptions(cache, "anonymous", privateProblem.slug).queryKey),
  ).toBeUndefined();
  stop();
});

it("uses the credential-free catalog transport only with an explicit global filter", async () => {
  const cache = client();
  for (const identity of [undefined, "anonymous" as const, actor("account-a")]) {
    for (const library of [undefined, "global" as const, "private" as const]) {
      const options = catalogQueryOptions(cache, identity, { library });
      if (options.enabled) await cache.fetchQuery(options);
    }
  }
  for (const request of requests) {
    if (!request.headers.has("Authorization"))
      expect(new URL(request.url).searchParams.get("library")).toBe("global");
  }
});
