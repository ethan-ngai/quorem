/** @file model.ts @description Read-only social discovery contracts. @module social */
export interface PlayerIdentity {
  id: string;
  displayName: string;
  username: string | null;
  image: string;
  color: number;
}
export interface ShowdownRecord {
  played: number;
  wins: number;
  draws: number;
  losses: number;
}
export interface Rival {
  player: PlayerIdentity;
  record: ShowdownRecord;
  lastPlayedAt: string;
}
export interface SocialOverview {
  viewer: PlayerIdentity;
  windowDays: number;
  minimumMatches: number;
  rivals: Rival[];
}
export interface PlayerPage {
  items: PlayerIdentity[];
  total: number;
}
export interface PlayerProfile {
  player: PlayerIdentity;
  record: ShowdownRecord;
  headToHead: ShowdownRecord;
  isSelf: boolean;
  windowDays: number;
}
export {
  rivalryWindowDays,
  rivalryMinimumMatches,
  socialPageSize,
} from "@quorem/contracts/social-policy";
export interface SocialReader {
  overview(userId: string): Promise<SocialOverview>;
  players(userId: string, search: string, offset: number): Promise<PlayerPage>;
  profile(userId: string, participantId: string): Promise<PlayerProfile>;
}
