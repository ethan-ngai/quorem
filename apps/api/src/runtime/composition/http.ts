import { identityRoutes } from "../../modules/identity/routes.ts";
import { capabilityRepository } from "../../adapters/postgres/access/repository.ts";
/** @file http.ts @description Compose canonical HTTP domains with selected runtime ports. @module runtime */
import type { ConnectionScope } from "@quorem/database/core";
import { languageRuntime } from "@quorem/execution";
import { createApp } from "../../app.ts";
import type { ManagedPrincipal, LocalPrincipal, Principal } from "../../modules/identity/model.ts";
import type { Coordinator } from "../../modules/events/scheduling/scheduling.ts";
import type { ExecutionWakePublisher } from "../../modules/events/dispatch/ports.ts";
import { guestRoutes } from "../../modules/identity/guest/routes.ts";
import type { GuestIdentityReader } from "../../modules/identity/guest/credentials.ts";
import { problemRoutes } from "../../modules/problems/routes.ts";
import { authoringRoutes } from "../../modules/problems/authoring/routes.ts";
import { workspaceRoutes } from "../../modules/workspace/routes.ts";
import { admissionRoutes } from "../../modules/judging/admission/routes.ts";
import { submissionRoutes } from "../../modules/judging/results/routes.ts";
import { matchLifecycleRoutes } from "../../modules/matches/lifecycle/routes.ts";
import { matchInvitationRoutes } from "../../modules/matches/invitations/routes.ts";
import { interviewLifecycleRoutes } from "../../modules/interviews/lifecycle/routes.ts";
import { interviewQuestionRoutes } from "../../modules/interviews/question/routes.ts";
import { interviewDocumentRoutes } from "../../modules/interviews/document/routes.ts";
import { interviewPresenceRoutes } from "../../modules/interviews/presence/routes.ts";
import { interviewMonitoringRoutes } from "../../modules/interviews/monitoring/routes.ts";
import { interviewExecutionRoutes } from "../../modules/interviews/execution/routes.ts";
import { problemQueries } from "../../adapters/postgres/problems/queries/repository.ts";
import { questionAuthoring } from "../../adapters/postgres/problems/authoring/repository.ts";
import { workspaceRepository } from "../../adapters/postgres/workspace/repository.ts";
import { postgresWorkspaceAdmission } from "../../adapters/postgres/judging/admission/repository.ts";
import { submissionSnapshots } from "../../adapters/postgres/judging/results/repository.ts";
import { matchLifecycle } from "../../adapters/postgres/matches/lifecycle/repository.ts";
import { matchInvitations } from "../../adapters/postgres/matches/invitations/repository.ts";
import { matchLanguageSelection } from "../../adapters/postgres/matches/selection/language.ts";
import { interviewLifecycle } from "../../adapters/postgres/interviews/lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../../adapters/postgres/interviews/question/prepare.ts";
import { interviewSnapshotStream } from "../../adapters/postgres/interviews/question/stream.ts";
import { interviewQuestionCommands } from "../../adapters/postgres/interviews/question/commands.ts";
import { interviewDocumentCommands } from "../../adapters/postgres/interviews/document/commands.ts";
import { interviewPresence } from "../../adapters/postgres/interviews/presence/repository.ts";
import { interviewMonitoring } from "../../adapters/postgres/interviews/monitoring/repository.ts";
import { postgresInterviewAdmission } from "../../adapters/postgres/interviews/execution/repository.ts";
import { prearmReceipts } from "../../adapters/postgres/events/scheduling/prearm.ts";
import { publicGuestBudget } from "../../adapters/postgres/identity/guest.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export interface HttpPorts {
  run: Run;
  identify: (request: Request) => Promise<Principal | undefined>;
  origins: readonly string[];
  managed: (token: string) => Promise<ManagedPrincipal | LocalPrincipal>;
  guests: GuestIdentityReader & { endMatch(hash: string): Promise<boolean> };
  trustedPeer: () => string | undefined;
  deadline: Coordinator;
  execution: Coordinator;
  wake: ExecutionWakePublisher;
  inviteKey: Uint8Array;
  shards: number;
  guestAdmission: boolean;
  guestExecution: boolean;
  localStrongBypass: boolean;
}
/** No network callback is invoked while a domain transaction is held. */
export function composeHttp(ports: HttpPorts) {
  const { run, identify } = ports;
  const app = createApp({ allowedOrigins: ports.origins, requestId: () => crypto.randomUUID() });
  const options = { losslessCases: true, guestExecution: ports.guestExecution };
  const execution = {
    identify,
    guestExecution: ports.guestExecution,
    receipts: prearmReceipts(run, "execution"),
    coordinator: ports.execution,
    publisher: ports.wake,
    shard: 0,
  };
  const matches = matchLifecycle(run, {
    inviteKey: ports.inviteKey,
    receipts: prearmReceipts(run),
    coordinator: ports.deadline,
    shards: ports.shards,
    guestCreation: ports.guestAdmission,
  });
  const budget = { allow: (peer: string) => run((scope) => publicGuestBudget(scope).allow(peer)) };
  app.route(
    "/",
    guestRoutes({
      allowedOrigins: ports.origins,
      admissionEnabled: ports.guestAdmission,
      trustedPeer: ports.trustedPeer,
      budget,
      managed: ports.managed,
      guests: ports.guests,
    }),
  );
  app.route(
    "/",
    identityRoutes({
      identify,
      guests: ports.guests,
      capabilities: {
        capabilities: (userId) => run((scope) => capabilityRepository(scope).capabilities(userId)),
      },
    }),
  );
  app.route("/", problemRoutes({ queries: problemQueries(run), identify }));
  app.route(
    "/",
    authoringRoutes({
      identify,
      authoring: questionAuthoring(run, languageRuntime),
      allowLocalStrongBypass: ports.localStrongBypass,
      now: () => Math.floor(Date.now() / 1000),
    }),
  );
  app.route("/", workspaceRoutes({ identify, repository: workspaceRepository(run) }));
  app.route(
    "/",
    admissionRoutes({ ...execution, commit: postgresWorkspaceAdmission(run, options) }),
  );
  app.route("/", submissionRoutes({ identify, snapshots: submissionSnapshots(run) }));
  app.route("/", matchLifecycleRoutes({ identify, lifecycle: matches }));
  app.route(
    "/",
    matchInvitationRoutes({
      identify,
      invitations: matchInvitations(run, ports.inviteKey),
      language: matchLanguageSelection(run, ports.inviteKey),
      allowedOrigins: ports.origins,
      admissionEnabled: ports.guestAdmission,
      trustedPeer: ports.trustedPeer,
      budget,
    }),
  );
  app.route(
    "/",
    interviewLifecycleRoutes({
      identify,
      lifecycle: interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: interviewSnapshotStream(run),
      }),
      allowedOrigins: ports.origins,
      trustedPeer: ports.trustedPeer,
      budget,
    }),
  );
  app.route("/", interviewQuestionRoutes({ identify, questions: interviewQuestionCommands(run) }));
  app.route("/", interviewDocumentRoutes({ identify, documents: interviewDocumentCommands(run) }));
  app.route("/", interviewPresenceRoutes({ identify, presence: interviewPresence(run) }));
  app.route("/", interviewMonitoringRoutes({ identify, monitoring: interviewMonitoring(run) }));
  app.route(
    "/",
    interviewExecutionRoutes({ ...execution, commit: postgresInterviewAdmission(run, options) }),
  );
  return { app, matches, submissions: submissionSnapshots(run) };
}
