import { Hono } from "hono";
import { ApplicationError } from "../../../application/error.ts";
import { identifyRequest } from "../../identity/routes.ts";
import type { Principal } from "../../identity/model.ts";
import type { ExecutionWakePublisher } from "../../events/dispatch/ports.ts";
import type { Coordinator, Receipts } from "../../events/scheduling/scheduling.ts";
import { admitWithRecovery, type AdmissionFence } from "./admit.ts";
import { parseWorkspaceCommand, type WorkspaceCommand } from "./command.ts";

interface Result {
  id: string;
  state: string;
  sourceHash: string;
  admittedAt: string;
}
export interface AdmissionDependencies {
  identify(request: Request): Promise<Principal | undefined>;
  guestExecution: boolean;
  receipts: Receipts;
  coordinator: Coordinator;
  publisher: ExecutionWakePublisher;
  shard: number;
  commit(
    principal: Principal,
    key: string,
    command: WorkspaceCommand,
    fence: AdmissionFence,
  ): Promise<Result>;
}
const limit = 2 * 1024 * 1024 + 512 * 1024;
async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApplicationError("payload_too_large", "Invalid request body", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError("invalid_input", "Invalid request body", 400);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    text = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ApplicationError("payload_too_large", "Invalid request body", 413);
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  } finally {
    reader.releaseLock();
  }
}
/** Unmounted admission transport; all execution context is resolved by the transaction owner. */
export function admissionRoutes(deps: AdmissionDependencies): Hono {
  const app = new Hono();
  app.post("/v1/submissions", async (c) => {
    const who = await identifyRequest((request) => deps.identify(request), c.req.raw);
    if (!who) throw new ApplicationError("unauthenticated", "Sign in required", 401);
    if (who.kind === "guest" && !deps.guestExecution)
      throw new ApplicationError(
        "temporarily_unavailable",
        "Guest execution is temporarily paused",
        503,
      );
    const key = c.req.header("Idempotency-Key") ?? "",
      command = await parseWorkspaceCommand(await readBody(c.req.raw), key);
    const result = await admitWithRecovery({
      receipts: deps.receipts,
      coordinator: deps.coordinator,
      publisher: deps.publisher,
      shard: deps.shard,
      commit: (fence) => deps.commit(who, key, command, fence),
    });
    return c.json(result, 202);
  });
  return app;
}
