/** @file api.ts @description Typed social queries, isolated by signed-in identity. @module social */
import { ApiError, api, requireData } from "../../api/client";
export async function getSocial(signal?: AbortSignal) {
  const { data, error } = await api().GET("/v1/social", { signal });
  return requireData(data, error);
}
export async function getPlayers(q: string, offset: number, signal?: AbortSignal) {
  const { data, error } = await api().GET("/v1/players", {
    params: { query: { q, offset } },
    signal,
  });
  return requireData(data, error);
}
export async function getPlayer(id: string, signal?: AbortSignal) {
  const { data, error } = await api().GET("/v1/players/{id}", { params: { path: { id } }, signal });
  return requireData(data, error);
}

/** Revoked visibility must hide cached profiles; transient failures may retain them. */
export function canRetainSocialData(error: unknown): boolean {
  return !(
    error instanceof ApiError && ["unauthenticated", "forbidden", "not_found"].includes(error.code)
  );
}
