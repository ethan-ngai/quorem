export interface Capabilities {
  authorCustomQuestions: boolean;
  interviewConcurrency: number;
  hostGuests: boolean;
  hostedIntelligence: boolean;
  experimental: boolean;
  interviews: boolean;
  guestConcurrency: number;
}
export interface CapabilityReader {
  capabilities(userId: string): Promise<Capabilities>;
}
