/** @file routes.ts @description Interview execution admission HTTP transport. @module interviews */
import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../identity/model.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { ExecutionWakePublisher } from "../../events/dispatch/ports.ts";
import type { Coordinator, Receipts } from "../../events/scheduling/scheduling.ts";
import { admitWithRecovery, type AdmissionFence } from "../../judging/admission/admit.ts";
import { parseInterviewExecution, type InterviewExecutionCommand } from "./command.ts";
const limit = 2 * 1024 * 1024 + 512 * 1024;
async function read(request: Request): Promise<string> {
  const reader = request.body?.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  if (!reader) throw new ApplicationError("invalid_input", "Invalid request body", 400);
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApplicationError("payload_too_large", "Invalid request body", 413);
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (e) {
    if (e instanceof ApplicationError) throw e;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  } finally {
    reader.releaseLock();
  }
}
export function interviewExecutionRoutes(deps: {
  identify(request: Request): Promise<Principal | undefined>;
  guestExecution: boolean;
  receipts: Receipts;
  coordinator: Coordinator;
  publisher: ExecutionWakePublisher;
  shard: number;
  commit(
    actor: Principal,
    id: string,
    key: string,
    command: InterviewExecutionCommand,
    fence: AdmissionFence,
  ): Promise<{ id: string; state: string; sourceHash: string; admittedAt: string }>;
}): Hono {
  const app = new Hono();
  app.post("/v1/interviews/:id/submissions", async (c) => {
    const actor = await identifyRequest((r) => deps.identify(r), c.req.raw);
    if (!actor)
      throw new ApplicationError("unauthenticated", "Sign in or join this interview", 401);
    if (actor.kind === "guest" && !deps.guestExecution)
      throw new ApplicationError(
        "temporarily_unavailable",
        "Guest execution is temporarily paused",
        503,
      );
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new ApplicationError("not_found", "Interview unavailable", 404);
    const key = c.req.header("Idempotency-Key") ?? "",
      command = await parseInterviewExecution(await read(c.req.raw), key);
    const result = await admitWithRecovery({
      receipts: deps.receipts,
      coordinator: deps.coordinator,
      publisher: deps.publisher,
      shard: deps.shard,
      commit: (fence) => deps.commit(actor, id, key, command, fence),
    });
    return c.json(result, 202);
  });
  return app;
}
