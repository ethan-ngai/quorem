import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { DevelopmentIdentity, paths, ProblemVersion } from "@quorem/contracts";
import { api, publicApi, requireData } from "../../api/client";
import { fetchProblem, fetchProblemVersion } from "../editor/api";
import type { CatalogSearch } from "./catalogSearch";

export type ProblemActor = DevelopmentIdentity | "anonymous" | undefined;
type CatalogPage = paths["/v1/problems"]["get"]["responses"][200]["content"]["application/json"];
const publicScope = "public";
const pendingScope = "pending";
const signedOutPrivateScope = "signed-out-private";
const staleTime = 30_000;
export const catalogPageSize = 20;

// Only explicitly global responses enter the shared public scope.
function catalogContext(actor: ProblemActor, library: CatalogSearch["library"]) {
  if (actor === "anonymous" && library === "private")
    return { scope: signedOutPrivateScope, library };
  const scope =
    library === "global" || actor === "anonymous" || (actor === undefined && library !== "private")
      ? publicScope
      : (actor ?? pendingScope);
  return {
    scope,
    library: scope === publicScope && library !== "private" ? ("global" as const) : library,
  };
}

const problemKey = (scope: string, value: string, byID = false) =>
  ["problem", scope, byID ? "version" : "slug", value] as const;
function freshState<T>(client: QueryClient, key: readonly unknown[]) {
  const state = client.getQueryState<T>(key);
  return state?.data && Date.now() - state.dataUpdatedAt < staleTime ? state : undefined;
}

const facetsKey = (scope: string, library: CatalogSearch["library"]) =>
  ["public-problem-facets", scope, library] as const;

function seedQuestions(client: QueryClient, scope: string, page: CatalogPage, started: number) {
  const updatedAt = Date.now();
  for (const item of page.items) {
    for (const key of [problemKey(scope, item.slug), problemKey(scope, item.id, true)]) {
      // A slower catalog response must not replace a newer detail read.
      if ((client.getQueryState(key)?.dataUpdatedAt ?? 0) <= started)
        client.setQueryData(key, item, { updatedAt });
    }
  }
}

export function catalogQueryOptions(
  client: QueryClient,
  actor: ProblemActor,
  search: CatalogSearch,
) {
  const context = catalogContext(actor, search.library);
  const filters = {
    ...search,
    library: context.library,
    page: search.page ?? 1,
    limit: catalogPageSize,
  };
  return queryOptions<CatalogPage>({
    queryKey: ["public-problems", context.scope, filters] as const,
    enabled: context.scope !== pendingScope,
    staleTime,
    placeholderData:
      context.scope !== publicScope && search.library !== "private"
        ? () =>
            freshState<CatalogPage>(client, [
              "public-problems",
              publicScope,
              { ...filters, library: "global" },
            ])?.data
        : undefined,
    queryFn: async ({ signal }) => {
      if (context.scope === pendingScope) throw new Error("Account still loading");
      // A local development server may assign an owner even without browser credentials.
      if (context.scope === signedOutPrivateScope)
        return {
          items: [],
          topics: [],
          companies: [],
          total: 0,
          page: filters.page,
          limit: filters.limit,
        };
      const started = Date.now();
      const transport =
        context.scope === publicScope ? publicApi() : api(actor as DevelopmentIdentity);
      const { data, error } = await transport.GET("/v1/problems", {
        params: { query: filters },
        signal,
      });
      const page = requireData(data, error);
      seedQuestions(client, context.scope, page, started);
      client.setQueryData(facetsKey(context.scope, context.library), {
        topics: page.topics,
        companies: page.companies,
      });
      return page;
    },
  });
}

// Server topics are unfiltered; retain them across same-scope filter changes.
export function catalogFacets(
  client: QueryClient,
  actor: ProblemActor,
  search: CatalogSearch,
  page?: CatalogPage,
) {
  const context = catalogContext(actor, search.library);
  return (
    page ??
    client.getQueryData<Pick<CatalogPage, "topics" | "companies">>(
      facetsKey(context.scope, context.library),
    ) ?? { topics: [], companies: [] }
  );
}

// Pending identities may reuse proven-public content, never personalized responses.
export function problemQueryOptions(
  client: QueryClient,
  actor: ProblemActor,
  value: string,
  byID = false,
) {
  const publicState = freshState<ProblemVersion>(client, problemKey(publicScope, value, byID));
  const scope =
    actor === "anonymous" || (actor === undefined && publicState?.data)
      ? publicScope
      : (actor ?? pendingScope);
  return queryOptions({
    queryKey: problemKey(scope, value, byID),
    enabled: actor !== undefined && !!value,
    staleTime,
    initialData: publicState?.data,
    initialDataUpdatedAt: publicState?.dataUpdatedAt,
    queryFn: async () => {
      if (actor === undefined) throw new Error("Account still loading");
      if (actor !== "anonymous")
        return byID ? fetchProblemVersion(actor, value) : fetchProblem(actor, value);
      const transport = publicApi();
      const result = byID
        ? await transport.GET("/v1/problem-versions/{id}", { params: { path: { id: value } } })
        : await transport.GET("/v1/problems/{slug}", { params: { path: { slug: value } } });
      return requireData(result.data as ProblemVersion | undefined, result.error);
    },
  });
}
