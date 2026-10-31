import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authAdapterSchema } from "@quorem/database/auth-adapter-schema";
import type { ConnectionScope } from "@quorem/database/core";
import type { BetterAuthOptions } from "better-auth";

type Adapter = ReturnType<ReturnType<typeof drizzleAdapter>>;
type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const settings = { provider: "pg", schema: authAdapterSchema, transaction: true } as const;

export function scopedDrizzleAdapter(run: RunScope): (options: BetterAuthOptions) => Adapter {
  return (options) => {
    // Adapter construction is synchronous; all SQL methods use a fresh owned scope.
    const metadata = drizzleAdapter({ _: {} }, settings)(options);
    const call = (method: keyof Adapter, args: unknown[]) => run(scope => scope.withDatabase(async db => {
      const adapter = drizzleAdapter(db, settings)(options);
      const fn = adapter[method];
      if (typeof fn !== "function") throw new Error("Unsupported auth adapter operation");
      return Reflect.apply(fn, adapter, args);
    }));
    return {
      ...metadata,
      create: (...args: unknown[]) => call("create", args),
      findOne: (...args: unknown[]) => call("findOne", args),
      findMany: (...args: unknown[]) => call("findMany", args),
      count: (...args: unknown[]) => call("count", args),
      update: (...args: unknown[]) => call("update", args),
      updateMany: (...args: unknown[]) => call("updateMany", args),
      delete: (...args: unknown[]) => call("delete", args),
      deleteMany: (...args: unknown[]) => call("deleteMany", args),
      consumeOne: (...args: unknown[]) => call("consumeOne", args),
      incrementOne: (...args: unknown[]) => call("incrementOne", args),
      transaction: (...args: unknown[]) => call("transaction", args),
    } as unknown as Adapter;
  };
}
