/** @file team.ts @description Team collaboration commands bound to the authorized faction. @module events */
import { ApplicationError } from "../../../application/error.ts";
import type { Factions } from "../../factions/model.ts";
import type { CommandHandler } from "./ports.ts";

export function teamCommands(id: string, team: number, factions: Factions): CommandHandler {
  const invalid = () => new ApplicationError("invalid_input", "Invalid team command", 400);
  return {
    execute(actor, { type, fields }) {
      const execute = (key: string, body: Record<string, unknown>) =>
        factions.command(actor, id, key, type, body, team);
      if (type === "pull") return execute("", { epoch: fields.epoch, version: fields.version });
      if (type === "peers") return execute("", {});
      const body =
        type === "push" ? fields.push : type === "presence" ? fields.presence : undefined;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid();
      const key = type === "push" ? fields.key : "";
      if (typeof key !== "string" || (type === "push" && (key.length < 8 || key.length > 128)))
        throw invalid();
      return execute(key, body as Record<string, unknown>);
    },
  };
}
