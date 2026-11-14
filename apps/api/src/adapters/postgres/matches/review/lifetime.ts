/** @file lifetime.ts @description Shared review and cleanup boundaries for guest rounds. @module matches */
import { sql, type SQL } from "drizzle-orm";

/** The join counter covers guests who left before the round started. */
export const hasMatchGuests = (match: SQL) => sql`(
  ${match}.guest_joins>0 OR EXISTS (
    SELECT 1 FROM match_participants member JOIN users u ON u.id=member.owner_id
    WHERE member.match_id=${match}.id AND u.kind='guest'
  )
)`;

/** Direct invitations share their lobby with the round, so completion closes that lobby. */
export const guestLobbyClosed = (match: SQL) => sql`(
  ${hasMatchGuests(match)} AND (
    ${match}.party_id IS NULL OR EXISTS (
      SELECT 1 FROM parties p WHERE p.id=${match}.party_id AND p.disbanded_at IS NOT NULL
    )
  )
)`;
