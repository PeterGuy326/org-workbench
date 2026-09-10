const GOAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const { isPositionId } = require("@roleweave/shared/position-id");

function invalid(message) {
  return { status: 400, body: { code: "goal_request_invalid", message, retryable: false } };
}

function validateGoalId(goalId) {
  return typeof goalId === "string" && GOAL_ID.test(goalId);
}

function validateGoalPath(goalId, suffix = "") {
  return validateGoalId(goalId) ? `/goals/${encodeURIComponent(goalId)}${suffix}` : null;
}

function validateGoalCreateRequest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "acceptanceCriteria,description,title" ||
      typeof value.title !== "string" || typeof value.description !== "string" ||
      !Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length < 1 || value.acceptanceCriteria.length > 32 ||
      value.acceptanceCriteria.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 512)) {
    return { ok: false, response: invalid("goal create accepts title, description, and 1-32 bounded acceptance criteria") };
  }
  return { ok: true, request: { title: value.title, description: value.description, acceptanceCriteria: value.acceptanceCriteria } };
}

function validateGoalUpdateRequest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: invalid("goal update must be an object") };
  }
  const keys = Object.keys(value).sort().join(",");
  if (keys === "status" && ["active", "paused", "completed", "abandoned"].includes(value.status)) {
    return { ok: true, request: { status: value.status } };
  }
  if (keys === "criterionId,criterionStatus" && typeof value.criterionId === "string" && ["open", "met", "blocked"].includes(value.criterionStatus)) {
    return { ok: true, request: { criterionId: value.criterionId, criterionStatus: value.criterionStatus } };
  }
  return { ok: false, response: invalid("goal update accepts status or criterionId and criterionStatus") };
}

function validateGoalNodeCreateRequest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: invalid("goal node request must be an object") };
  }
  const keys = Object.keys(value).sort();
  const allowed = new Set(["kind", "label", "parentNodeId", "positionId"]);
  if (!Object.hasOwn(value, "kind") || !Object.hasOwn(value, "label") || keys.some((key) => !allowed.has(key)) ||
      !["milestone", "task"].includes(value.kind) || typeof value.label !== "string" || value.label.trim().length === 0 ||
      (value.parentNodeId !== undefined && !validateGoalId(value.parentNodeId)) ||
      (value.positionId !== undefined && !isPositionId(value.positionId))) {
    return { ok: false, response: invalid("goal node accepts milestone/task, a bounded label, and optional parentNodeId/positionId") };
  }
  return { ok: true, request: { kind: value.kind, label: value.label, ...(value.parentNodeId !== undefined ? { parentNodeId: value.parentNodeId } : {}), ...(value.positionId !== undefined ? { positionId: value.positionId } : {}) } };
}

module.exports = {
  validateGoalId,
  validateGoalPath,
  validateGoalCreateRequest,
  validateGoalUpdateRequest,
  validateGoalNodeCreateRequest,
};
