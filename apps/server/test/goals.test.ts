import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { routes } from "@roleweave/shared";
import type { Goal, GoalView, TurnRecord, TurnRunDriver, TurnRunRequest, TurnRunResult } from "@roleweave/shared";
import { api, assertPosixMode, connectSse, copyExampleWorkspace, startTestServer } from "./helpers.js";

async function openWorkspace(baseUrl: string, token: string, dir: string): Promise<void> {
  const response = await api(baseUrl, "/workspace/open", { method: "POST", token, body: { path: dir } });
  assert.equal(response.status, 200);
}

test("Goal persists as the operator-owned spine and projects graph state across reloads", async () => {
  const server = await startTestServer();
  const workspace = await copyExampleWorkspace();
  try {
    await openWorkspace(server.baseUrl, server.token, workspace);
    const created = await api(server.baseUrl, routes.goals, {
      method: "POST",
      token: server.token,
      body: {
        title: "Ship the collaboration graph",
        description: "Keep every agent branch accountable to one outcome.",
        acceptanceCriteria: ["Goal can be resumed after restart", "Global state identifies blocked branches"],
      },
    });
    assert.equal(created.status, 201);
    const goal = created.body as Goal;
    assert.equal(goal.status, "active");
    assert.match(goal.goalId, /^[0-9a-f-]{36}$/);

    const goalDir = path.join(workspace, ".digital-employee", "workbench", "goals", goal.goalId);
    await assertPosixMode(goalDir, 0o700);
    await assertPosixMode(path.join(goalDir, "goal.json"), 0o600);

    const node = await api(server.baseUrl, `${routes.goals}/${goal.goalId}/nodes`, {
      method: "POST",
      token: server.token,
      body: { kind: "task", label: "Verify local recovery", positionId: "repo-owner" },
    });
    assert.equal(node.status, 201);

    const updatedCriterion = await api(server.baseUrl, `${routes.goals}/${goal.goalId}`, {
      method: "PATCH",
      token: server.token,
      body: { criterionId: "criterion-1", criterionStatus: "met" },
    });
    assert.equal(updatedCriterion.status, 200);

    const view = await api(server.baseUrl, `${routes.goals}/${goal.goalId}`, { token: server.token });
    assert.equal(view.status, 200);
    const projected = view.body as GoalView;
    assert.equal(projected.state.progress.percent, 50);
    assert.equal(projected.state.assignedPositionIds[0], "repo-owner");
    assert.ok(projected.edges.length >= 1);
    assert.ok(projected.activities.some((activity) => activity.kind === "node.created"));

    const listed = await api(server.baseUrl, routes.goals, { token: server.token });
    assert.equal(listed.status, 200);
    assert.equal((listed.body as { goals: Goal[] }).goals[0]?.goalId, goal.goalId);

    const secondStoreView = await server.ctx.goalStore.getView(workspace, goal.goalId);
    assert.equal(secondStoreView.goal.title, goal.title);
    assert.equal(secondStoreView.state.progress.percent, 50);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.close();
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
});

test("Goal binding follows a turn and never changes the engine envelope", async () => {
  const calls: TurnRunRequest[] = [];
  const turnDriver: TurnRunDriver = {
    async turnRun(request): Promise<TurnRunResult> {
      calls.push(request);
      const runId = "goal-test-run";
      const timestamp = new Date().toISOString();
      const events: TurnRunResult["events"] = [
        { type: "run.started", runId, timestamp },
        { type: "run.completed", runId, timestamp, output: "evidence", terminalReason: "goal_met" },
      ];
      for (const event of events) request.onEvent?.(event);
      return { status: "trusted", events, diagnostic: "" };
    },
  };
  const server = await startTestServer(undefined, turnDriver);
  const workspace = await copyExampleWorkspace();
  const sse = connectSse(server.baseUrl, server.token);
  try {
    await openWorkspace(server.baseUrl, server.token, workspace);
    const created = await api(server.baseUrl, routes.goals, {
      method: "POST", token: server.token,
      body: { title: "Review release readiness", description: "", acceptanceCriteria: ["Evidence is recorded"] },
    });
    const goal = created.body as Goal;
    const response = await api(server.baseUrl, routes.turns, {
      method: "POST", token: server.token,
      body: { positionId: "repo-owner", input: "Collect the release evidence", engine: "qoder", goalId: goal.goalId },
    });
    assert.equal(response.status, 200);
    const record = response.body as TurnRecord;
    assert.equal(record.goalId, goal.goalId);
    assert.equal(typeof record.goalNodeId, "string");

    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0]!.envelope, "goalId"), false);

    const event = await waitForGoalStatus(sse, goal.goalId, "completed");
    const envelope = JSON.parse(event.data) as { payload: { goalId: string; status: string } };
    assert.equal(envelope.payload.goalId, goal.goalId);
    assert.equal(envelope.payload.status, "completed");

    const view = await api(server.baseUrl, `${routes.goals}/${goal.goalId}`, { token: server.token });
    assert.equal((view.body as GoalView).state.completedNodeCount, 1);
    assert.equal((view.body as GoalView).state.health, "healthy");
  } finally {
    sse.close();
    await server.close();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

async function waitForGoalStatus(sse: ReturnType<typeof connectSse>, goalId: string, status: string): Promise<{ data: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const frame = sse.events.find((candidate) => {
      if (candidate.event !== "goal.updated") return false;
      try {
        const payload = (JSON.parse(candidate.data) as { payload?: { goalId?: string; status?: string } }).payload;
        return payload?.goalId === goalId && payload.status === status;
      } catch {
        return false;
      }
    });
    if (frame !== undefined) return frame;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timeout waiting for goal.updated ${goalId} ${status}`);
}

test("Goal routes fail closed for malformed requests", async () => {
  const server = await startTestServer();
  const workspace = await copyExampleWorkspace();
  try {
    await openWorkspace(server.baseUrl, server.token, workspace);
    const invalidCreate = await api(server.baseUrl, routes.goals, {
      method: "POST", token: server.token, body: { title: "missing fields" },
    });
    assert.equal(invalidCreate.status, 400);
    assert.equal((invalidCreate.body as { code: string }).code, "goal_request_invalid");

    const invalidId = await api(server.baseUrl, `${routes.goals}/not-a-uuid`, { token: server.token });
    assert.equal(invalidId.status, 400);
    assert.equal((invalidId.body as { code: string }).code, "goal_request_invalid");
  } finally {
    await server.close();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("a group fan-out keeps every member branch on the same Goal", async () => {
  const server = await startTestServer();
  const workspace = await copyExampleWorkspace();
  try {
    await openWorkspace(server.baseUrl, server.token, workspace);
    const goalResponse = await api(server.baseUrl, routes.goals, {
      method: "POST", token: server.token,
      body: { title: "Coordinate release review", description: "", acceptanceCriteria: ["Members report back"] },
    });
    const goal = goalResponse.body as Goal;
    const groupResponse = await api(server.baseUrl, routes.groups, {
      method: "POST", token: server.token,
      body: { memberPositionIds: ["repo-owner", "release-engineer"] },
    });
    const group = groupResponse.body as { conversationRef: string };
    const accepted = await api(server.baseUrl, `${routes.groups}/${group.conversationRef}/turns`, {
      method: "POST", token: server.token,
      body: { input: "Review the release", engine: "qoder", mentions: ["repo-owner", "release-engineer"], goalId: goal.goalId },
    });
    assert.equal(accepted.status, 202);

    let projected: GoalView | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await api(server.baseUrl, `${routes.goals}/${goal.goalId}`, { token: server.token });
      assert.equal(current.status, 200, JSON.stringify(current.body));
      projected = current.body as GoalView;
      if (projected.state.completedNodeCount === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(projected?.state.completedNodeCount, 2);
    assert.deepEqual(projected?.state.assignedPositionIds, ["release-engineer", "repo-owner"]);
    assert.equal(projected?.nodes.filter((node) => node.goalId === goal.goalId && node.kind === "task").length, 2);
    assert.equal(projected?.edges.filter((edge) => edge.kind === "contains").length, 2);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await server.close();
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
});
