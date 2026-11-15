/** @file playerDashboardQuery.ts @description Shared, account-keyed activity query for Home and Practice. */
import type { DevelopmentIdentity } from "@quorem/contracts";
import { queryOptions } from "@tanstack/react-query";
import { api, requireData } from "../../api/client";

export const playerDashboardKey = (actor: DevelopmentIdentity) =>
  ["player-dashboard", actor] as const;

export function playerDashboardQuery(actor: DevelopmentIdentity, enabled: boolean) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return queryOptions({
    queryKey: [...playerDashboardKey(actor), timeZone],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api(actor).GET("/v1/me/dashboard", {
        params: { query: { timeZone } },
        signal,
      });
      return requireData(data, error, response.status);
    },
  });
}
