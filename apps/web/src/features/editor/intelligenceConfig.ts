/** @file intelligenceConfig.ts @description Hosted engine rollout switch. @module editor */
/** Hosted engines remain an opt-in experiment until paid access is enforced by the server. */
export const hostedIntelligenceEnabled = import.meta.env.VITE_HOSTED_INTELLIGENCE === "true";
