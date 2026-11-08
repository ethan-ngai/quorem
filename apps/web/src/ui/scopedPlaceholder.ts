/** @file scopedPlaceholder.ts @description Retain results only inside the same query scope. @module ui */
import type { QueryKey } from "@tanstack/react-query";

export function scopedPlaceholder(scope: readonly (string | boolean | undefined)[]) {
  return <T>(previous: T | undefined, query: { queryKey: QueryKey } | undefined) =>
    query && scope.every((part, index) => query.queryKey[index] === part) ? previous : undefined;
}
