export interface RatePolicy { limit: number; seconds: number }
export interface AuthRepository {
  rateLimit(scope: string, subject: string, policy: RatePolicy): Promise<{ allowed: boolean; retryAfter: number }>;
  profile(id: string): Promise<{profile_color: number; profile_color_revision: bigint} | undefined>;
  recordAssurance(sessionId: string): Promise<void>;
  sessionAuthority(sessionId: string, subject: string): Promise<{valid: boolean; strongAt?: number}>;
  socialEmail(provider: string, accountId: string): Promise<string | undefined>;
  hasSocialProof(hash: string): Promise<boolean>;
  verifySocialProof(proof: string, token: string): Promise<{provider: string; linking: boolean} | undefined>;
  setSocialEmail(proof: string, email: string, token: string): Promise<boolean>;
  createSocialProof(proof: string, provider: string, accountId: string, linking: boolean): Promise<void>;
}
