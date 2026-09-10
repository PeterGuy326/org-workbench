import type { IncomingMessage, ServerResponse } from "node:http";
import { OrgApiError, errorCodes, goalCriterionStatuses, goalNodeKinds, goalStatuses } from "@roleweave/shared";
import type { GoalAcceptanceCriterion, GoalStatus } from "@roleweave/shared";
import type { ControlPlaneContext } from "../context.js";
import { readJsonBody, sendJson } from "../http.js";
import { assertGoalId, type GoalNodeCreateInput } from "../goals/store.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function requestError(message: string): OrgApiError {
  return new OrgApiError(errorCodes.goal_request_invalid, 400, message);
}

function parseCreate(raw: unknown): { title: string; description: string; acceptanceCriteria: string[] } {
  if (!isRecord(raw) || !exactKeys(raw, ["title", "description", "acceptanceCriteria"])) {
    throw requestError("goal create accepts exactly title, description, and acceptanceCriteria");
  }
  if (typeof raw.title !== "string" || typeof raw.description !== "string") {
    throw requestError("title and description must be strings");
  }
  if (!Array.isArray(raw.acceptanceCriteria) || raw.acceptanceCriteria.some((item) => typeof item !== "string")) {
    throw requestError("acceptanceCriteria must be a string list");
  }
  return {
    title: raw.title,
    description: raw.description,
    acceptanceCriteria: raw.acceptanceCriteria as string[],
  };
}

function parseUpdate(raw: unknown): { status?: GoalStatus; criterionId?: string; criterionStatus?: GoalAcceptanceCriterion["status"] } {
  if (!isRecord(raw)) throw requestError("goal update must be a JSON object");
  const keys = Object.keys(raw).sort().join(",");
  if (keys === "status") {
    if (!goalStatuses.includes(raw.status as GoalStatus)) throw requestError("status is invalid");
    return { status: raw.status as GoalStatus };
  }
  if (keys === "criterionId,criterionStatus") {
    if (typeof raw.criterionId !== "string" || !goalCriterionStatuses.includes(raw.criterionStatus as GoalAcceptanceCriterion["status"])) {
      throw requestError("criterionId and criterionStatus are invalid");
    }
    return {
      criterionId: raw.criterionId,
      criterionStatus: raw.criterionStatus as GoalAcceptanceCriterion["status"],
    };
  }
  throw requestError("goal update accepts exactly status or criterionId and criterionStatus");
}

function parseNodeCreate(raw: unknown): GoalNodeCreateInput {
  if (!isRecord(raw) || !exactKeys(raw, ["kind", "label"], ["parentNodeId", "positionId"])) {
    throw requestError("goal node create accepts kind, label, and optional parentNodeId/positionId");
  }
  if (!goalNodeKinds.includes(raw.kind as GoalNodeCreateInput["kind"]) || (raw.kind !== "milestone" && raw.kind !== "task")) {
    throw requestError("kind must be milestone or task");
  }
  if (typeof raw.label !== "string") throw requestError("label must be a string");
  if (raw.parentNodeId !== undefined && typeof raw.parentNodeId !== "string") throw requestError("parentNodeId must be a string");
  if (raw.positionId !== undefined && typeof raw.positionId !== "string") throw requestError("positionId must be a string");
  return {
    kind: raw.kind,
    label: raw.label,
    ...(raw.parentNodeId !== undefined ? { parentNodeId: raw.parentNodeId } : {}),
    ...(raw.positionId !== undefined ? { positionId: raw.positionId } : {}),
  };
}

export async function handleGoalList(ctx: ControlPlaneContext, res: ServerResponse): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  sendJson(res, 200, await ctx.goalStore.list(workspace.dir));
}

export async function handleGoalCreate(ctx: ControlPlaneContext, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  const goal = await ctx.goalStore.create(workspace.dir, parseCreate(await readJsonBody<unknown>(req)));
  ctx.bus.publish("goal.updated", { goalId: goal.goalId, action: "created" });
  sendJson(res, 201, goal);
}

export async function handleGoalGet(ctx: ControlPlaneContext, res: ServerResponse, goalId: string): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  sendJson(res, 200, await ctx.goalStore.getView(workspace.dir, assertGoalId(goalId)));
}

export async function handleGoalUpdate(ctx: ControlPlaneContext, req: IncomingMessage, res: ServerResponse, goalId: string): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  const id = assertGoalId(goalId);
  const goal = await ctx.goalStore.update(workspace.dir, id, parseUpdate(await readJsonBody<unknown>(req)));
  ctx.bus.publish("goal.updated", { goalId: id, action: "updated" });
  sendJson(res, 200, goal);
}

export async function handleGoalNodeCreate(ctx: ControlPlaneContext, req: IncomingMessage, res: ServerResponse, goalId: string): Promise<void> {
  const workspace = ctx.workspace.requireOpen();
  const id = assertGoalId(goalId);
  const node = await ctx.goalStore.createNode(workspace.dir, id, parseNodeCreate(await readJsonBody<unknown>(req)));
  ctx.bus.publish("goal.updated", { goalId: id, nodeId: node.nodeId, action: "node.created" });
  sendJson(res, 201, node);
}
