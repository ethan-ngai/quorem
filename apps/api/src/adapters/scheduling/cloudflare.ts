/** @file cloudflare.ts @description Sharded Cloudflare Durable Object coordinator binding. @module events */
import type { Coordinator } from "../../modules/events/scheduling/scheduling.ts";
interface Stub {
  wake(shard: number): Promise<void>;
}
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): Stub;
}
export function cloudflareCoordinator(namespace: Namespace): Coordinator {
  const wake = (shard: number) =>
    namespace.get(namespace.idFromName(`deadline-${shard}`)).wake(shard);
  return { prearm: wake, wake };
}
