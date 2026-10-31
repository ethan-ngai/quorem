/** @file interview.ts @description Interview RPC dispatch to canonical domain ports. @module events */
import { ApplicationError } from "../../../application/error.ts";
import type { InterviewDocuments, DocumentPush } from "../../interviews/document/model.ts";
import type { InterviewPresence, PresenceInput } from "../../interviews/presence/model.ts";
import type { InterviewMonitoring, RuleKind } from "../../interviews/monitoring/model.ts";
import type { CommandHandler } from "./ports.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid interview command", 400);
const text = (v: unknown) => {
  if (typeof v !== "string") throw invalid();
  return v;
};
const retry = (v: unknown) => {
  const value = text(v),
    n = new TextEncoder().encode(value).length;
  if (n < 8 || n > 128) throw invalid();
  return value;
};
export function interviewCommands(
  id: string,
  deps: {
    documents: InterviewDocuments;
    presence: InterviewPresence;
    monitoring: InterviewMonitoring;
  },
): CommandHandler {
  return {
    async execute(actor, c) {
      const f = c.fields;
      switch (c.type) {
        case "pull":
          if (!Number.isSafeInteger(f.version)) throw invalid();
          return deps.documents.pull(actor, id, text(f.epoch), f.version as number);
        case "push":
          if (!f.push || typeof f.push !== "object" || Array.isArray(f.push) || !c.rawPush)
            throw invalid();
          return deps.documents.push(actor, id, retry(f.key), f.push as DocumentPush, c.rawPush);
        case "presence":
          if (!f.presence || typeof f.presence !== "object" || Array.isArray(f.presence))
            throw invalid();
          return deps.presence.update(actor, id, f.presence as PresenceInput);
        case "peers":
          return deps.presence.peers(actor, id);
        case "rule-event": {
          const kind = text(f.kind);
          if (kind !== "paste" && kind !== "focus") throw invalid();
          await deps.monitoring.report(actor, id, retry(f.key), kind as RuleKind);
          return {};
        }
        default:
          throw invalid();
      }
    },
  };
}
