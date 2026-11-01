import { and, eq, isNull, sql } from "drizzle-orm";
import { auth } from "@quorem/database/schema";
import { classifyDatabaseError, type ConnectionScope } from "@quorem/database/core";
import { ProfileWriteUncertain, type ProfileRepository } from "../profile.ts";

type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const { userInQuorem_auth: user } = auth;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 5000 };
export function drizzleProfileRepository(run: RunScope): ProfileRepository {
  return {
    read(id) {
      return run((scope) =>
        scope.transaction(
          { ...options, readOnly: true },
          async (tx) =>
            (
              await tx
                .select({
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  username: user.username,
                  image: user.image,
                  profile_color: user.profile_color,
                })
                .from(user)
                .where(eq(user.id, id))
                .limit(1)
            )[0],
        ),
      );
    },
    setColor(id, color) {
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx
            .update(user)
            .set({
              profile_color: color,
              profile_color_revision: sql`GREATEST(${user.profile_color_revision}+1,floor(extract(epoch from clock_timestamp())*1000)::bigint)`,
              updatedAt: sql`clock_timestamp()`,
            })
            .where(eq(user.id, id));
        }),
      );
    },
    async replace(id, previous, next) {
      try {
        return await run((scope) =>
          scope.transaction(
            options,
            async (tx) =>
              (
                await tx
                  .update(user)
                  .set({ image: next, updatedAt: sql`clock_timestamp()` })
                  .where(
                    and(
                      eq(user.id, id),
                      previous === null ? isNull(user.image) : eq(user.image, previous),
                    ),
                  )
                  .returning({ id: user.id })
              ).length === 1,
          ),
        );
      } catch (error) {
        if (classifyDatabaseError(error) === "unknown_commit")
          throw new ProfileWriteUncertain("Profile update outcome unknown", { cause: error });
        throw error;
      }
    },
    contains(image) {
      return run((scope) =>
        scope.transaction(
          { ...options, readOnly: true },
          async (tx) =>
            (await tx.select({ id: user.id }).from(user).where(eq(user.image, image)).limit(1))
              .length > 0,
        ),
      );
    },
  };
}
