import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { DevelopmentIdentity, paths, ProblemVersion } from "@quorem/contracts";
import { api, publicApi, requireData } from "../../api/client";
import { fetchProblem, fetchProblemVersion } from "../editor/api";
import { catalogKind, type CatalogSearch } from "./catalogSearch";
import { scopedPlaceholder } from "../../ui/scopedPlaceholder";

export type ProblemActor = DevelopmentIdentity | "anonymous" | undefined;
type CatalogPage = paths["/v1/problems"]["get"]["responses"][200]["content"]["application/json"];
export type FoundationalTopic = NonNullable<CatalogPage["foundationalTopics"]>[number];
export type CompanyFacet = NonNullable<CatalogPage["companyFacets"]>[number];
type CatalogFacets = Pick<
  CatalogPage,
  "topics" | "foundationalTopics" | "topicAliases" | "companies" | "companyFacets"
>;
const publicScope = "public";
const pendingScope = "pending";
const signedOutPrivateScope = "signed-out-private";
const staleTime = 30_000;
export const catalogPageSize = 20;
type CatalogRequest = Omit<CatalogSearch, "sort"> & {
  sort?: CatalogSearch["sort"] | "recommended";
};

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

type CatalogKind = Parameters<typeof catalogKind>[0];
const facetsKey = (scope: string, library: CatalogSearch["library"], search: CatalogKind) =>
  ["public-problem-facets", scope, library, ...catalogKind(search)] as const;
const catalogScope = (scope: string, library: CatalogSearch["library"], search: CatalogKind) =>
  ["public-problems", scope, library, ...catalogKind(search)] as const;

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
  search: CatalogRequest,
) {
  const context =
    search.sort === "recommended"
      ? {
          scope:
            actor === "anonymous" && search.library === "private"
              ? signedOutPrivateScope
              : (actor ?? pendingScope),
          library: actor === "anonymous" ? (search.library ?? "global") : search.library,
        }
      : catalogContext(actor, search.library);
  const filters = {
    ...search,
    sql: catalogKind(search)[0],
    library: context.library,
    page: search.page ?? 1,
    limit: search.limit ?? catalogPageSize,
  };
  const scope =
    search.sort === "recommended"
      ? (["recommended-problems", context.scope, context.library] as const)
      : catalogScope(context.scope, context.library, search);
  const retain = scopedPlaceholder(scope);
  return queryOptions<CatalogPage>({
    queryKey: [...scope, filters] as const,
    enabled: context.scope !== pendingScope,
    staleTime: search.sort === "recommended" ? 0 : staleTime,
    placeholderData:
      search.sort === "recommended"
        ? undefined
        : (previous, query) =>
            retain(previous, query) ??
            (context.scope !== publicScope && search.library !== "private"
              ? freshState<CatalogPage>(client, [
                  ...catalogScope(publicScope, "global", search),
                  { ...filters, library: "global" },
                ])?.data
              : undefined),
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
        context.scope === publicScope || actor === "anonymous"
          ? publicApi()
          : api(actor as DevelopmentIdentity);
      const { data, error } = await transport.GET("/v1/problems", {
        params: { query: filters },
        signal,
      });
      const page = requireData(data, error);
      if (search.sort !== "recommended") {
        seedQuestions(client, context.scope, page, started);
        client.setQueryData(facetsKey(context.scope, context.library, search), {
          topics: page.topics,
          foundationalTopics: page.foundationalTopics,
          topicAliases: page.topicAliases,
          companies: page.companies,
          companyFacets: page.companyFacets,
        });
      }
      return page;
    },
  });
}

// Facets are stable across search and pagination within the same catalog kind.
export function catalogFacets(
  client: QueryClient,
  actor: ProblemActor,
  search: CatalogSearch,
  page?: CatalogPage,
) {
  const context = catalogContext(actor, search.library);
  return (
    page ??
    client.getQueryData<CatalogFacets>(facetsKey(context.scope, context.library, search)) ?? {
      topics: [],
      companies: [],
    }
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
