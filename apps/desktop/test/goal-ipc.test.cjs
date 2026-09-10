const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateGoalCreateRequest,
  validateGoalNodeCreateRequest,
  validateGoalPath,
  validateGoalUpdateRequest,
} = require("../src/goal-ipc.cjs");

const goalId = "123e4567-e89b-42d3-a456-426614174000";

test("Goal IPC accepts the bounded create/update/node shapes and only builds local paths", () => {
  assert.equal(validateGoalPath(goalId), `/goals/${goalId}`);
  assert.equal(validateGoalPath("../escape"), null);
  assert.deepEqual(
    validateGoalCreateRequest({ title: "Release", description: "", acceptanceCriteria: ["Evidence"] }).request,
    { title: "Release", description: "", acceptanceCriteria: ["Evidence"] },
  );
  assert.deepEqual(validateGoalUpdateRequest({ status: "paused" }).request, { status: "paused" });
  assert.deepEqual(validateGoalNodeCreateRequest({ kind: "task", label: "Review", parentNodeId: goalId }).request, {
    kind: "task", label: "Review", parentNodeId: goalId,
  });
});

test("Goal IPC fails closed for unknown fields, malformed ids, and missing relationships", () => {
  assert.equal(validateGoalCreateRequest({ title: "Release", description: "", acceptanceCriteria: ["Evidence"], owner: "x" }).ok, false);
  assert.equal(validateGoalUpdateRequest({ status: "done" }).ok, false);
  assert.equal(validateGoalNodeCreateRequest({ kind: "task", label: "Review", parentNodeId: "not-a-uuid" }).ok, false);
  assert.equal(validateGoalNodeCreateRequest({ kind: "task", label: "Review", positionId: "bad id" }).ok, false);
});
