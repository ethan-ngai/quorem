import { gt } from "drizzle-orm";
import { auth } from "@quorem/database/schema";
import type { ConnectionScope } from "@quorem/database/core";
import type { PhotoReferencePage } from "../profile-object-cutover.ts";

const user = auth.userInQuorem_auth;
export function profileObjectReferences(
  run: <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>,
) {
  return async (cursor: string | undefined, limit: number): Promise<PhotoReferencePage> => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new Error("Invalid page limit");
    const rows = await run((scope) =>
      scope.transaction({ readOnly: true, statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, (tx) =>
        tx
          .select({ id: user.id, image: user.image })
          .from(user)
          .where(cursor === undefined ? undefined : gt(user.id, cursor))
          .orderBy(user.id)
          .limit(limit + 1),
      ),
    );
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { rows: page, next: more ? page.at(-1)!.id : undefined };
  };
}
