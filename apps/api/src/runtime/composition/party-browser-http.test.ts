/** @file party-browser-http.test.ts @description Real two-account and guest party rounds with bounded shared review. @module runtime */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import type {
  PartySnapshot,
  MatchSnapshot,
  MatchReview,
  PublishedQuestion,
  Workspace,
} from "@quorem/contracts";
import { matchPreset } from "@quorem/contracts/match-rules";
import { startBrowserFixture } from "./browser-fixture.ts";

void test(
  "real party survives rematches, freezes sharing, and reviews code after a forfeit",
  { timeout: 180000 },
  async () => {
    const database = process.env.QUOREM_BROWSER_FIXTURE_DATABASE_URL;
    const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
    if (!database || !socket) throw new Error("Fixture database and Docker socket required");
    const fixture = await startBrowserFixture(database, socket);
    const origin = fixture.webOrigin;
    type Actor = { bearer?: string; cookie?: string };
    const alice: Actor = { bearer: fixture.bearers.alice };
    const bob: Actor = { bearer: fixture.bearers.bob };
    async function response(path: string, actor: Actor, body?: unknown, method = "POST") {
      return fetch(origin + path, {
        method,
        headers: {
          origin,
          ...(actor.bearer ? { authorization: `Bearer ${actor.bearer}` } : {}),
          ...(actor.cookie ? { cookie: actor.cookie } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          "idempotency-key": randomUUID(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
    }
    async function json<T>(
      path: string,
      actor: Actor,
      body?: unknown,
      method = "POST",
    ): Promise<T> {
      const result = await response(path, actor, body, method);
      if (!result.ok) throw new Error(`${method} party fixture request returned ${result.status}`);
      return result.json() as Promise<T>;
    }
    async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const value = await read();
        if (ready(value)) return value;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("Party fixture transition did not complete");
    }
    try {
      const problem = await json<PublishedQuestion>(
        "/v1/problems/sql-positive-items",
        alice,
        undefined,
        "GET",
      );
      const settings = {
        selectedProblemVersionId: problem.id,
        durationMinutes: 30,
        mode: "free-for-all",
        accessMode: "guests_allowed",
        shareCodeAfterMatch: true,
      };
      const created = await json<{ party: PartySnapshot; inviteUrl: string }>(
        "/v1/parties",
        alice,
        settings,
      );
      const id = created.party.id;
      const token = created.inviteUrl.split("/").at(-1)!;
      await json<PartySnapshot>("/v1/parties/join", bob, { token });
      const bootstrap = await response("/v1/guest-sessions", {}, {});
      assert.equal(bootstrap.status, 204);
      const guest: Actor = {
        cookie: bootstrap.headers
          .getSetCookie()
          .map((value) => value.split(";", 1)[0])
          .join("; "),
      };
      assert.ok(guest.cookie);
      await json<PartySnapshot>(`/v1/parties/invitations/${token}/guest`, guest, {
        name: "Review guest",
      });
      const actors = [alice, bob, guest];
      async function readyAll() {
        for (const actor of actors)
          await json("/v1/presence/heartbeat", actor, { windowId: randomUUID() });
        for (const actor of actors) await json(`/v1/parties/${id}/ready`, actor, { ready: true });
      }
      await readyAll();
      const started = await waitFor(
        () => json<PartySnapshot>(`/v1/parties/${id}`, alice, undefined, "GET"),
        (value) => !!value.currentMatchId,
      );
      assert.ok(started.currentMatchId);
      const firstId = started.currentMatchId;
      async function submit(matchId: string, actor: Actor, source: string) {
        const session = await json<{ user: { id: string } }>(
          "/v1/session",
          actor,
          undefined,
          "GET",
        );
        const match = await json<MatchSnapshot>(`/v1/matches/${matchId}`, actor, undefined, "GET");
        const own = match.participants.find((person) => person.userId === session.user.id);
        assert.ok(own?.workspaceId);
        const admitted = await json<{ id: string }>("/v1/submissions", actor, {
          workspaceId: own.workspaceId,
          kind: "submit",
          source,
        });
        return waitFor(
          () =>
            json<{ state: string; verdict?: string }>(
              `/v1/submissions/${admitted.id}`,
              actor,
              undefined,
              "GET",
            ),
          (value) => ["completed", "failed", "cancelled"].includes(value.state),
        );
      }
      assert.equal(
        (await submit(firstId, bob, "SELECT id FROM items WHERE false;")).verdict,
        "wrong_answer",
      );
      async function saveDraft(matchId: string, actor: Actor, source: string) {
        const match = await json<MatchSnapshot>(`/v1/matches/${matchId}`, actor, undefined, "GET");
        const participant = match.participants.find((person) => person.workspaceId);
        assert.ok(match.shareFinalCode && participant?.workspaceId);
        const saved = await response(
          `/v1/matches/${matchId}/review/code`,
          actor,
          { workspaceId: participant.workspaceId, source },
          "PUT",
        );
        assert.equal(saved.status, 204);
        return participant.userId;
      }
      const guestDraft = "SELECT id FROM items; -- unsubmitted";
      await saveDraft(firstId, guest, guestDraft);
      assert.equal(
        (await submit(firstId, alice, "SELECT id FROM items WHERE id > 0 ORDER BY id;")).verdict,
        "accepted",
      );
      const first = await waitFor(
        () => json<MatchSnapshot>(`/v1/matches/${firstId}`, alice, undefined, "GET"),
        (value) => value.state === "completed" && !value.reviewPending,
      );
      assert.ok(first.startedAt && first.outcome?.completedAt);
      assert.ok(Date.parse(first.outcome.completedAt) >= Date.parse(first.startedAt));
      assert.equal(first.partyId, id);
      const reviewed = await json<MatchReview>(
        `/v1/matches/${firstId}/review`,
        guest,
        undefined,
        "GET",
      );
      assert.equal(reviewed.shareCodeAfterMatch, true);
      assert.equal(reviewed.participants.length, 3);
      assert.equal(
        reviewed.participants.find((person) => person.submission?.winning)?.submission?.source,
        "SELECT id FROM items WHERE id > 0 ORDER BY id;",
      );
      assert.ok(
        reviewed.participants
          .filter((person) => !person.own)
          .every((person) => person.workspace === null),
      );
      const guestOriginal = reviewed.participants.find((person) => person.own)!;
      assert.deepEqual(guestOriginal.finalCode, { language: "postgresql", source: guestDraft });
      assert.equal(guestOriginal.submission, null);
      const opponent = reviewed.participants.find(
        (person) => !person.own && person.submission?.verdict === "wrong_answer",
      )!;
      assert.ok(guestOriginal.workspace);
      assert.equal(
        (await response(`/v1/workspaces/${guestOriginal.workspace.id}`, guest, undefined, "GET"))
          .status,
        200,
      );
      assert.equal(
        (
          await response("/v1/submissions", guest, {
            workspaceId: guestOriginal.workspace.id,
            kind: "submit",
            source: "SELECT id FROM items WHERE id > 0 ORDER BY id;",
          })
        ).ok,
        false,
      );
      const experiment = await json<Workspace>(`/v1/matches/${firstId}/review/workspaces`, guest, {
        participantUserId: opponent.userId,
        language: "postgresql",
      });
      assert.equal(experiment.kind, "review");
      assert.equal(experiment.reviewMatchId, firstId);
      assert.equal(experiment.matchId, undefined);
      const originalScores = first.participants.map((person) => ({
        userId: person.userId,
        score: person.bestScore,
        forfeited: person.forfeited,
      }));
      // Review uses the same two-token execution bucket as competitive work.
      await new Promise((resolve) => setTimeout(resolve, 6000));
      for (const kind of ["run", "submit"] as const) {
        const admitted = await json<{ id: string }>("/v1/submissions", guest, {
          workspaceId: experiment.id,
          kind,
          source: "SELECT id FROM items WHERE id > 0 ORDER BY id;",
        });
        const result = await waitFor(
          () =>
            json<{ state: string; verdict?: string }>(
              `/v1/submissions/${admitted.id}`,
              guest,
              undefined,
              "GET",
            ),
          (value) => ["completed", "failed", "cancelled"].includes(value.state),
        );
        assert.equal(result.state, "completed");
        assert.equal(result.verdict, "accepted");
      }
      const unchanged = await json<MatchSnapshot>(
        `/v1/matches/${firstId}`,
        guest,
        undefined,
        "GET",
      );
      assert.deepEqual(unchanged.outcome, first.outcome);
      assert.deepEqual(
        unchanged.participants.map((person) => ({
          userId: person.userId,
          score: person.bestScore,
          forfeited: person.forfeited,
        })),
        originalScores,
      );
      assert.deepEqual(
        (await json<MatchReview>(`/v1/matches/${firstId}/review`, guest, undefined, "GET"))
          .participants,
        reviewed.participants,
      );
      await json(
        `/v1/parties/${id}/settings`,
        alice,
        { ...settings, shareCodeAfterMatch: false },
        "PUT",
      );
      assert.equal(
        (await json<MatchReview>(`/v1/matches/${firstId}/review`, bob, undefined, "GET"))
          .shareCodeAfterMatch,
        true,
      );
      await readyAll();
      const second = await waitFor(
        () => json<PartySnapshot>(`/v1/parties/${id}`, guest, undefined, "GET"),
        (value) => !!value.currentMatchId && value.currentMatchId !== firstId,
      );
      assert.equal(second.id, id);
      const secondId = second.currentMatchId!;
      assert.equal(
        (await response(`/v1/matches/${firstId}/review`, alice, undefined, "GET")).status,
        404,
      );
      assert.equal(
        (await response(`/v1/matches/${firstId}/review`, guest, undefined, "GET")).status,
        404,
      );
      assert.equal(
        (await response(`/v1/workspaces/${experiment.id}`, guest, undefined, "GET")).status,
        404,
      );
      assert.equal(
        (
          await response("/v1/submissions", guest, {
            workspaceId: experiment.id,
            kind: "submit",
            source: "SELECT id FROM items;",
          })
        ).status,
        404,
      );
      await json(`/v1/matches/${secondId}/forfeit`, bob, {});
      assert.equal(
        (await response(`/v1/matches/${secondId}/review`, bob, undefined, "GET")).status,
        404,
      );
      await json(`/v1/matches/${secondId}/forfeit`, guest, {});
      await waitFor(
        () => json<MatchSnapshot>(`/v1/matches/${secondId}`, alice, undefined, "GET"),
        (value) => value.state === "completed" && !value.reviewPending,
      );
      const privateReview = await json<MatchReview>(
        `/v1/matches/${secondId}/review`,
        guest,
        undefined,
        "GET",
      );
      assert.equal(privateReview.shareCodeAfterMatch, false);
      assert.equal(privateReview.participants.length, 1);
      assert.equal(privateReview.participants[0]?.own, true);
      assert.equal(
        (
          await response(`/v1/matches/${secondId}/review/workspaces`, guest, {
            participantUserId: opponent.userId,
            language: "postgresql",
          })
        ).status,
        404,
      );
      let lastRoundId = secondId;
      for (const victory of ["race", "high_score"] as const) {
        await json(
          `/v1/parties/${id}/settings`,
          alice,
          { ...settings, rules: { ...matchPreset("casual"), victory } },
          "PUT",
        );
        await readyAll();
        const next = await waitFor(
          () => json<PartySnapshot>(`/v1/parties/${id}`, alice, undefined, "GET"),
          (value) => !!value.currentMatchId && value.currentMatchId !== lastRoundId,
        );
        const matchId = next.currentMatchId!;
        lastRoundId = matchId;
        if (victory === "high_score") {
          const scored = await submit(
            matchId,
            bob,
            "SELECT id FROM items WHERE id > 0 ORDER BY id;",
          );
          assert.equal(scored.verdict, "accepted");
        }
        const drafts = new Map<string, string>();
        for (const [index, actor] of actors.entries()) {
          const source = `SELECT id FROM items; -- player ${index}'s unsubmitted code`;
          drafts.set(await saveDraft(matchId, actor, source), source);
        }
        await json(`/v1/matches/${matchId}/forfeit`, bob, {});
        await json(`/v1/matches/${matchId}/forfeit`, guest, {});
        const forfeitedMatch = await waitFor(
          () => json<MatchSnapshot>(`/v1/matches/${matchId}`, alice, undefined, "GET"),
          (value) => value.state === "completed" && !value.reviewPending,
        );
        assert.equal(forfeitedMatch.rules.victory, victory);
        assert.equal(forfeitedMatch.outcome?.reason, "forfeit");
        const forfeitReview = await json<MatchReview>(
          `/v1/matches/${matchId}/review`,
          alice,
          undefined,
          "GET",
        );
        assert.equal(forfeitReview.participants.length, drafts.size);
        for (const participant of forfeitReview.participants) {
          assert.equal(participant.submission, null);
          assert.deepEqual(participant.finalCode, {
            language: "postgresql",
            source: drafts.get(participant.userId),
          });
        }
        const forfeitedPlayer = forfeitedMatch.participants.find((player) => player.forfeited);
        assert.ok(forfeitedPlayer);
        const comparison = await json<Workspace>(
          `/v1/matches/${matchId}/review/workspaces`,
          alice,
          {
            participantUserId: forfeitedPlayer.userId,
            language: "postgresql",
          },
        );
        assert.equal(comparison.kind, "review");
      }

      assert.equal(
        (await json<MatchReview>(`/v1/matches/${lastRoundId}/review`, guest, undefined, "GET"))
          .participants.length,
        actors.length,
      );
      const guestSession = await json<{ kind: string }>("/v1/session", guest, undefined, "GET");
      assert.equal(guestSession.kind, "guest");
      const bobSession = await json<{ user: { id: string } }>("/v1/session", bob, undefined, "GET");
      await json(`/v1/parties/${id}/leave`, alice, {});
      const transferred = await json<PartySnapshot>(`/v1/parties/${id}`, bob, undefined, "GET");
      assert.equal(transferred.hostUserId, bobSession.user.id);
      await json(`/v1/parties/${id}/disband`, bob, {});
      assert.equal(
        (
          await json<{ party: PartySnapshot | null }>(
            "/v1/parties/current",
            guest,
            undefined,
            "GET",
          )
        ).party,
        null,
      );
      const closedReview = await response(
        `/v1/matches/${lastRoundId}/review`,
        guest,
        undefined,
        "GET",
      );
      assert.equal(closedReview.status, 404);
      await closedReview.body?.cancel();
    } finally {
      await fixture.close();
    }
  },
);
