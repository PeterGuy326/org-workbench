import crypto from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GOAL_ACTIVITY_SCHEMA_VERSION,
  GOAL_EDGE_SCHEMA_VERSION,
  GOAL_LIST_SCHEMA_VERSION,
  GOAL_NODE_SCHEMA_VERSION,
  GOAL_SCHEMA_VERSION,
  GOAL_VIEW_SCHEMA_VERSION,
  OrgApiError,
  errorCodes,
  goalCriterionStatuses,
  goalEdgeKinds,
  goalNodeKinds,
  goalNodeStatuses,
  goalStatuses,
  isPositionId,
} from "@roleweave/shared";
import type {
  Goal,
  GoalAcceptanceCriterion,
  GoalActivity,
  GoalEdge,
  GoalEdgeKind,
  GoalList,
  GoalNode,
  GoalNodeKind,
  GoalNodeStatus,
  GoalState,
  GoalStatus,
  GoalView,
  TurnEngine,
} from "@roleweave/shared";
import { atomicWriteJson, nodeAtomicTurnWriteOperations } from "../turns/store.js";

const GOALS_ROOT = path.join(".digital-employee", "workbench", "goals");
const MAX_GOALS = 128;
const MAX_NODES = 1_024;
const MAX_EDGES = 2_048;
const MAX_ACTIVITIES = 2_048;
const MAX_GOAL_TEMP_FILES = 2_048;
const MAX_GOAL_RECORD_BYTES = 32 * 1024;
const MAX_NODE_RECORD_BYTES = 16 * 1024;
const MAX_EDGE_RECORD_BYTES = 256 * 1024;
const MAX_ACTIVITY_RECORD_BYTES = 8 * 1024;
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_CRITERION_LENGTH = 512;
const GOAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NODE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function storageError(message: string, cause?: unknown): OrgApiError {
  return new OrgApiError(
    errorCodes.goal_storage_failed,
    500,
    message,
    false,
    cause === undefined ? undefined : { cause },
  );
}

export function assertGoalId(value: unknown): string {
  if (typeof value !== "string" || !GOAL_ID_PATTERN.test(value)) {
    throw new OrgApiError(errorCodes.goal_request_invalid, 400, "goalId must be a server-generated UUID");
  }
  return value;
}

function assertNodeId(value: unknown): string {
  if (typeof value !== "string" || !NODE_ID_PATTERN.test(value)) {
    throw new OrgApiError(errorCodes.goal_request_invalid, 400, "nodeId must be a server-generated UUID");
  }
  return value;
}

function isAtomicGoalTemporaryName(name: string): boolean {
  if (!name.startsWith(".") || !name.endsWith(".tmp")) return false;
  const stem = name.slice(1, -4);
  if (stem.length <= 37 || stem.at(-37) !== ".") return false;
  const nonce = stem.slice(-36);
  if (!NODE_ID_PATTERN.test(nonce)) return false;
  const target = stem.slice(0, -37);
  if (!target.endsWith(".json")) return false;
  const base = target.slice(0, -5);
  return base === "goal" || base === "edges" || NODE_ID_PATTERN.test(base);
}

function assertText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new OrgApiError(errorCodes.goal_request_invalid, 400, `${field} must be a non-empty bounded string`);
  }
  if ([...value].some((character) => character.charCodeAt(0) < 0x20 && !"\n\r\t".includes(character))) {
    throw new OrgApiError(errorCodes.goal_request_invalid, 400, `${field} contains a control character`);
  }
  return value.trim();
}

function assertIso(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw storageError("local Goal record has an invalid timestamp");
  }
  return value;
}

function goalDir(workspace: string, goalId: string): string {
  return path.join(workspace, GOALS_ROOT, assertGoalId(goalId));
}

function goalFile(workspace: string, goalId: string): string {
  return path.join(goalDir(workspace, goalId), "goal.json");
}

function edgesFile(workspace: string, goalId: string): string {
  return path.join(goalDir(workspace, goalId), "edges.json");
}

function nodeFile(workspace: string, goalId: string, nodeId: string): string {
  const directory = path.resolve(path.join(goalDir(workspace, goalId), "nodes"));
  const file = path.resolve(path.join(directory, `${assertNodeId(nodeId)}.json`));
  if (path.dirname(file) !== directory) throw storageError("Goal node path escapes its Goal");
  return file;
}

function activityFile(workspace: string, goalId: string, activityId: string): string {
  const directory = path.resolve(path.join(goalDir(workspace, goalId), "activities"));
  const file = path.resolve(path.join(directory, `${assertNodeId(activityId)}.json`));
  if (path.dirname(file) !== directory) throw storageError("Goal activity path escapes its Goal");
  return file;
}

async function ensureDirectoryChain(workspace: string, goalId: string): Promise<void> {
  const rootStat = await fs.lstat(workspace).catch(() => null);
  if (rootStat === null || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw storageError("workspace must be a real directory for local Goal state");
  }
  const segments = [".digital-employee", "workbench", "goals", assertGoalId(goalId), "nodes"];
  let current = workspace;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError("Goal state path must not contain symbolic links");
    } catch (error) {
      if (error instanceof OrgApiError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw storageError("Goal state path is unreadable", error);
      await fs.mkdir(current, { mode: 0o700 });
      const created = await fs.lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) throw storageError("Goal state path creation was unsafe");
    }
    if (index > 0) await fs.chmod(current, 0o700);
  }
  const activities = path.join(path.dirname(current), "activities");
  try {
    const stat = await fs.lstat(activities);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError("Goal activity path must not contain symbolic links");
  } catch (error) {
    if (error instanceof OrgApiError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw storageError("Goal activity path is unreadable", error);
    await fs.mkdir(activities, { mode: 0o700 });
  }
  await fs.chmod(activities, 0o700);
}

async function readJson(file: string, maxBytes: number): Promise<unknown> {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    throw storageError("local Goal state is unreadable", error);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw storageError("local Goal state is not a bounded regular file");
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    throw storageError("local Goal state is not valid JSON", error);
  }
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function isCriterion(value: unknown): value is GoalAcceptanceCriterion {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ["criterionId", "title", "weight", "status"]) &&
    typeof record.criterionId === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(record.criterionId) &&
    typeof record.title === "string" && record.title.length > 0 && record.title.length <= MAX_CRITERION_LENGTH &&
    typeof record.weight === "number" && Number.isInteger(record.weight) && record.weight > 0 && record.weight <= 100 &&
    goalCriterionStatuses.includes(record.status as typeof goalCriterionStatuses[number]);
}

function isGoal(value: unknown): value is Goal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ["schemaVersion", "goalId", "title", "description", "status", "acceptanceCriteria", "rootNodeId", "createdAt", "updatedAt"]) &&
    record.schemaVersion === GOAL_SCHEMA_VERSION && typeof record.goalId === "string" && GOAL_ID_PATTERN.test(record.goalId) &&
    typeof record.title === "string" && record.title.length > 0 && record.title.length <= MAX_TITLE_LENGTH &&
    typeof record.description === "string" && record.description.length <= MAX_DESCRIPTION_LENGTH &&
    goalStatuses.includes(record.status as GoalStatus) && Array.isArray(record.acceptanceCriteria) &&
    record.acceptanceCriteria.length > 0 && record.acceptanceCriteria.length <= 32 && record.acceptanceCriteria.every(isCriterion) &&
    typeof record.rootNodeId === "string" && NODE_ID_PATTERN.test(record.rootNodeId) &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string";
}

function isNode(value: unknown): value is GoalNode {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ["schemaVersion", "nodeId", "goalId", "kind", "label", "status", "parentNodeId", "createdAt", "updatedAt"], ["positionId", "engine", "sessionId", "conversationRef", "turnId"]) &&
    record.schemaVersion === GOAL_NODE_SCHEMA_VERSION && typeof record.nodeId === "string" && NODE_ID_PATTERN.test(record.nodeId) &&
    typeof record.goalId === "string" && GOAL_ID_PATTERN.test(record.goalId) && goalNodeKinds.includes(record.kind as GoalNodeKind) &&
    typeof record.label === "string" && record.label.length > 0 && record.label.length <= MAX_TITLE_LENGTH &&
    goalNodeStatuses.includes(record.status as GoalNodeStatus) && (record.parentNodeId === null || (typeof record.parentNodeId === "string" && NODE_ID_PATTERN.test(record.parentNodeId))) &&
    (record.positionId === undefined || isPositionId(record.positionId)) &&
    (record.engine === undefined || ["qoder", "claude-code", "claude-local"].includes(record.engine as string)) &&
    (record.sessionId === undefined || typeof record.sessionId === "string") &&
    (record.conversationRef === undefined || typeof record.conversationRef === "string") &&
    (record.turnId === undefined || typeof record.turnId === "string") &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string";
}

function isEdge(value: unknown): value is GoalEdge {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ["schemaVersion", "edgeId", "goalId", "kind", "fromNodeId", "toNodeId", "createdAt"]) &&
    record.schemaVersion === GOAL_EDGE_SCHEMA_VERSION && typeof record.edgeId === "string" && NODE_ID_PATTERN.test(record.edgeId) &&
    typeof record.goalId === "string" && GOAL_ID_PATTERN.test(record.goalId) && goalEdgeKinds.includes(record.kind as GoalEdgeKind) &&
    typeof record.fromNodeId === "string" && NODE_ID_PATTERN.test(record.fromNodeId) &&
    typeof record.toNodeId === "string" && NODE_ID_PATTERN.test(record.toNodeId) && typeof record.createdAt === "string";
}

function isActivity(value: unknown): value is GoalActivity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return exactKeys(record, ["schemaVersion", "activityId", "goalId", "kind", "summary", "at"], ["nodeId"]) &&
    record.schemaVersion === GOAL_ACTIVITY_SCHEMA_VERSION && typeof record.activityId === "string" && NODE_ID_PATTERN.test(record.activityId) &&
    typeof record.goalId === "string" && GOAL_ID_PATTERN.test(record.goalId) &&
    ["goal.created", "goal.updated", "node.created", "node.updated"].includes(record.kind as string) &&
    typeof record.summary === "string" && record.summary.length > 0 && record.summary.length <= MAX_TITLE_LENGTH &&
    (record.nodeId === undefined || (typeof record.nodeId === "string" && NODE_ID_PATTERN.test(record.nodeId))) &&
    typeof record.at === "string";
}

function goalRootStatus(status: GoalStatus): GoalNodeStatus {
  if (status === "completed") return "completed";
  if (status === "abandoned") return "cancelled";
  return status === "active" ? "active" : "planned";
}

function deriveState(goal: Goal, nodes: GoalNode[]): GoalState {
  const totalWeight = goal.acceptanceCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const completedWeight = goal.acceptanceCriteria.filter((criterion) => criterion.status === "met").reduce((sum, criterion) => sum + criterion.weight, 0);
  const taskNodes = nodes.filter((node) => node.kind !== "goal");
  const activeNodeCount = taskNodes.filter((node) => node.status === "active").length;
  const completedNodeCount = taskNodes.filter((node) => node.status === "completed").length;
  const failedNodeCount = taskNodes.filter((node) => node.status === "failed").length;
  const blockedNodeCount = taskNodes.filter((node) => node.status === "blocked").length;
  const indeterminateNodeCount = taskNodes.filter((node) => node.status === "indeterminate").length;
  const blockedCriterion = goal.acceptanceCriteria.some((criterion) => criterion.status === "blocked");
  const health = blockedNodeCount > 0 || blockedCriterion ? "blocked" : failedNodeCount + indeterminateNodeCount > 0 ? "attention" : "healthy";
  const percent = totalWeight === 0 ? 0 : Math.round((completedWeight / totalWeight) * 100);
  let nextAction: string | null = null;
  if (goal.status === "active") {
    nextAction = health === "blocked"
      ? "Resolve blocked branches"
      : health === "attention"
        ? "Review failed or indeterminate branches"
        : percent >= 100
          ? "Review acceptance criteria and complete the Goal"
          : activeNodeCount > 0
            ? "Monitor active branches"
            : "Assign the next branch";
  }
  return {
    progress: { completedWeight, totalWeight, percent },
    health,
    activeNodeCount,
    completedNodeCount,
    failedNodeCount,
    blockedNodeCount,
    indeterminateNodeCount,
    assignedPositionIds: [...new Set(taskNodes.flatMap((node) => node.positionId ? [node.positionId] : []))].sort(),
    nextAction,
  };
}

export interface GoalCreateInput {
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface GoalNodeCreateInput {
  kind: "milestone" | "task";
  label: string;
  parentNodeId?: string;
  positionId?: string;
}

export interface GoalStartTurnInput {
  goalId: string;
  turnId: string;
  label: string;
  positionId: string;
  engine: TurnEngine;
  parentNodeId?: string;
  sessionId?: string;
  conversationRef?: string;
}

export class GoalStore {
  async create(workspace: string, input: GoalCreateInput): Promise<Goal> {
    const title = assertText(input.title, "title", MAX_TITLE_LENGTH);
    const description = input.description === "" ? "" : assertText(input.description, "description", MAX_DESCRIPTION_LENGTH);
    if (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.length === 0 || input.acceptanceCriteria.length > 32) {
      throw new OrgApiError(errorCodes.goal_request_invalid, 400, "acceptanceCriteria must contain 1-32 items");
    }
    const criteria: GoalAcceptanceCriterion[] = input.acceptanceCriteria.map((item, index) => ({
      criterionId: `criterion-${index + 1}`,
      title: assertText(item, `acceptanceCriteria[${index}]`, MAX_CRITERION_LENGTH),
      weight: 1,
      status: "open",
    }));
    const goalId = crypto.randomUUID();
    const rootNodeId = crypto.randomUUID();
    const now = new Date().toISOString();
    await this.assertGoalCapacity(workspace);
    await ensureDirectoryChain(workspace, goalId);
    const goal: Goal = {
      schemaVersion: GOAL_SCHEMA_VERSION,
      goalId,
      title,
      description,
      status: "active",
      acceptanceCriteria: criteria,
      rootNodeId,
      createdAt: now,
      updatedAt: now,
    };
    const root: GoalNode = {
      schemaVersion: GOAL_NODE_SCHEMA_VERSION,
      nodeId: rootNodeId,
      goalId,
      kind: "goal",
      label: title,
      status: "active",
      parentNodeId: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await atomicWriteJson(goalFile(workspace, goalId), goal, MAX_GOAL_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
      await atomicWriteJson(nodeFile(workspace, goalId, rootNodeId), root, MAX_NODE_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
      await atomicWriteJson(edgesFile(workspace, goalId), [], MAX_EDGE_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
      await this.appendActivity(workspace, goal, "goal.created", `Created Goal: ${title}`);
    } catch (error) {
      await fs.rm(goalDir(workspace, goalId), { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return goal;
  }

  async list(workspace: string): Promise<GoalList> {
    const root = path.join(workspace, GOALS_ROOT);
    let entries;
    try {
      const stat = await fs.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError("local Goal root is unreadable");
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: GOAL_LIST_SCHEMA_VERSION, goals: [] };
      if (error instanceof OrgApiError) throw error;
      throw storageError("local Goal root is unreadable", error);
    }
    const goals: Goal[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !GOAL_ID_PATTERN.test(entry.name)) throw storageError("local Goal root contains an unsafe entry");
      goals.push(await this.readGoal(workspace, entry.name));
      if (goals.length > MAX_GOALS) throw storageError("local Goal count exceeds its bound");
    }
    goals.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.goalId.localeCompare(right.goalId));
    return { schemaVersion: GOAL_LIST_SCHEMA_VERSION, goals };
  }

  async assertExists(workspace: string, goalId: string): Promise<Goal> {
    return this.readGoal(workspace, assertGoalId(goalId));
  }

  async getView(workspace: string, goalId: string): Promise<GoalView> {
    const goal = await this.assertExists(workspace, goalId);
    const directory = path.join(goalDir(workspace, goal.goalId), "nodes");
    await assertRealDirectory(directory, "local Goal nodes are unreadable");
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw storageError("local Goal nodes are unreadable", error);
    }
    const nodes: GoalNode[] = [];
    let temporaryCount = 0;
    for (const entry of entries) {
      if (entry.name.endsWith(".tmp")) {
        temporaryCount += 1;
        if (temporaryCount > MAX_GOAL_TEMP_FILES || !entry.isFile() || entry.isSymbolicLink() || !isAtomicGoalTemporaryName(entry.name)) throw storageError("local Goal nodes contain an unsafe temporary");
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) throw storageError("local Goal nodes contain an unsafe entry");
      const node = await readJson(path.join(directory, entry.name), MAX_NODE_RECORD_BYTES);
      if (!isNode(node) || node.goalId !== goal.goalId || nodeFile(workspace, goal.goalId, node.nodeId) !== path.resolve(path.join(directory, entry.name))) throw storageError("local Goal node is invalid");
      nodes.push(node);
      if (nodes.length > MAX_NODES) throw storageError("local Goal node count exceeds its bound");
    }
    if (!nodes.some((node) => node.nodeId === goal.rootNodeId && node.kind === "goal")) throw storageError("local Goal root node is missing");
    const rawEdges = await readJson(edgesFile(workspace, goal.goalId), MAX_EDGE_RECORD_BYTES);
    if (!Array.isArray(rawEdges) || rawEdges.length > MAX_EDGES || !rawEdges.every(isEdge)) throw storageError("local Goal edges are invalid");
    const edges = (rawEdges as GoalEdge[]).filter((edge) => edge.goalId === goal.goalId);
    if (edges.length !== rawEdges.length || edges.some((edge) => !nodes.some((node) => node.nodeId === edge.fromNodeId) || !nodes.some((node) => node.nodeId === edge.toNodeId))) throw storageError("local Goal edge references an unknown node");
    const activities = await this.readActivities(workspace, goal);
    nodes.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.nodeId.localeCompare(right.nodeId));
    edges.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.edgeId.localeCompare(right.edgeId));
    activities.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.activityId.localeCompare(right.activityId));
    return { schemaVersion: GOAL_VIEW_SCHEMA_VERSION, goal, nodes, edges, activities, state: deriveState(goal, nodes) };
  }

  async update(workspace: string, goalId: string, input: { status?: GoalStatus; criterionId?: string; criterionStatus?: GoalAcceptanceCriterion["status"] }): Promise<Goal> {
    const goal = await this.assertExists(workspace, goalId);
    if (input.status === undefined && input.criterionId === undefined) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "Goal update requires status or criterionId");
    const now = new Date().toISOString();
    let updated: Goal = { ...goal, acceptanceCriteria: goal.acceptanceCriteria.map((criterion) => ({ ...criterion })) };
    if (input.status !== undefined) {
      if (!goalStatuses.includes(input.status)) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "status is invalid");
      if (input.status === "completed" && updated.acceptanceCriteria.some((criterion) => criterion.status !== "met")) {
        throw new OrgApiError(errorCodes.goal_conflict, 409, "Goal cannot be completed before every acceptance criterion is met");
      }
      updated = { ...updated, status: input.status };
    }
    if (input.criterionId !== undefined) {
      if (!goalCriterionStatuses.includes(input.criterionStatus as typeof goalCriterionStatuses[number])) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "criterionStatus is invalid");
      let found = false;
      updated.acceptanceCriteria = updated.acceptanceCriteria.map((criterion) => {
        if (criterion.criterionId !== input.criterionId) return criterion;
        found = true;
        return { ...criterion, status: input.criterionStatus! };
      });
      if (!found) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "criterionId does not exist on the Goal");
    }
    updated.updatedAt = now;
    await atomicWriteJson(goalFile(workspace, goal.goalId), updated, MAX_GOAL_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
    const root = await this.readNode(workspace, goal.goalId, goal.rootNodeId);
    await this.writeNode(workspace, { ...root, label: updated.title, status: goalRootStatus(updated.status), updatedAt: now });
    await this.appendActivity(workspace, updated, "goal.updated", input.criterionId === undefined ? `Goal status: ${updated.status}` : `Criterion updated: ${input.criterionId}`, goal.rootNodeId);
    return updated;
  }

  async createNode(workspace: string, goalId: string, input: GoalNodeCreateInput): Promise<GoalNode> {
    const goal = await this.assertExists(workspace, goalId);
    const label = assertText(input.label, "label", MAX_TITLE_LENGTH);
    if (!goalNodeKinds.includes(input.kind) || (input.kind !== "milestone" && input.kind !== "task")) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "kind must be milestone or task");
    if (input.positionId !== undefined && !isPositionId(input.positionId)) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "positionId is invalid");
    const parentNodeId = input.parentNodeId === undefined ? goal.rootNodeId : assertNodeId(input.parentNodeId);
    const parent = await this.readNode(workspace, goal.goalId, parentNodeId);
    if (parent.goalId !== goal.goalId) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "parentNodeId does not belong to the Goal");
    const now = new Date().toISOString();
    const node: GoalNode = { schemaVersion: GOAL_NODE_SCHEMA_VERSION, nodeId: crypto.randomUUID(), goalId: goal.goalId, kind: input.kind, label, status: "planned", parentNodeId, ...(input.positionId !== undefined ? { positionId: input.positionId } : {}), createdAt: now, updatedAt: now };
    await this.assertNodeCapacity(workspace, goal);
    await this.writeNode(workspace, node);
    await this.appendEdge(workspace, { schemaVersion: GOAL_EDGE_SCHEMA_VERSION, edgeId: crypto.randomUUID(), goalId: goal.goalId, kind: "contains", fromNodeId: parentNodeId, toNodeId: node.nodeId, createdAt: now });
    const updatedGoal = { ...goal, updatedAt: now };
    await this.writeGoal(workspace, updatedGoal);
    await this.appendActivity(workspace, updatedGoal, "node.created", `Added ${input.kind}: ${label}`, node.nodeId);
    return node;
  }

  async startTurn(workspace: string, input: GoalStartTurnInput): Promise<GoalNode> {
    const goal = await this.assertExists(workspace, input.goalId);
    if (goal.status !== "active") throw new OrgApiError(errorCodes.goal_conflict, 409, "Goal is not accepting new turns in its current status");
    if (!NODE_ID_PATTERN.test(input.turnId) && !GOAL_ID_PATTERN.test(input.turnId)) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "turnId is invalid");
    if (!isPositionId(input.positionId)) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "positionId is invalid");
    const parentNodeId = input.parentNodeId === undefined ? goal.rootNodeId : assertNodeId(input.parentNodeId);
    const parent = await this.readNode(workspace, goal.goalId, parentNodeId);
    const now = new Date().toISOString();
    const node: GoalNode = {
      schemaVersion: GOAL_NODE_SCHEMA_VERSION,
      nodeId: crypto.randomUUID(),
      goalId: goal.goalId,
      kind: "task",
      label: assertText(input.label, "label", MAX_TITLE_LENGTH),
      status: "active",
      parentNodeId: parent.nodeId,
      positionId: input.positionId,
      engine: input.engine,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.conversationRef !== undefined ? { conversationRef: input.conversationRef } : {}),
      turnId: input.turnId,
      createdAt: now,
      updatedAt: now,
    };
    await this.assertNodeCapacity(workspace, goal);
    await this.writeNode(workspace, node);
    await this.appendEdge(workspace, { schemaVersion: GOAL_EDGE_SCHEMA_VERSION, edgeId: crypto.randomUUID(), goalId: goal.goalId, kind: "contains", fromNodeId: parent.nodeId, toNodeId: node.nodeId, createdAt: now });
    const updatedGoal = { ...goal, updatedAt: now };
    await this.writeGoal(workspace, updatedGoal);
    await this.appendActivity(workspace, updatedGoal, "node.created", `Started task for ${input.positionId}`, node.nodeId);
    return node;
  }

  async finishTurn(workspace: string, goalId: string, nodeId: string, status: GoalNodeStatus): Promise<void> {
    const goal = await this.assertExists(workspace, goalId);
    if (!goalNodeStatuses.includes(status)) throw new OrgApiError(errorCodes.goal_request_invalid, 400, "node status is invalid");
    const node = await this.readNode(workspace, goal.goalId, nodeId);
    const now = new Date().toISOString();
    const updatedNode = { ...node, status, updatedAt: now };
    await this.writeNode(workspace, updatedNode);
    const updatedGoal = { ...goal, updatedAt: now };
    await this.writeGoal(workspace, updatedGoal);
    await this.appendActivity(workspace, updatedGoal, "node.updated", `Task ${status}: ${node.label}`, node.nodeId);
  }

  private async readGoal(workspace: string, goalId: string): Promise<Goal> {
    let raw: unknown;
    try { raw = await readJson(goalFile(workspace, goalId), MAX_GOAL_RECORD_BYTES); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new OrgApiError(errorCodes.goal_missing, 404, `Goal not found: ${goalId}`);
      throw error;
    }
    if (!isGoal(raw) || raw.goalId !== goalId || assertIso(raw.createdAt) === "" || assertIso(raw.updatedAt) === "") throw storageError("local Goal record is invalid");
    return raw;
  }

  private async readNode(workspace: string, goalId: string, nodeId: string): Promise<GoalNode> {
    const raw = await readJson(nodeFile(workspace, goalId, nodeId), MAX_NODE_RECORD_BYTES);
    if (!isNode(raw) || raw.goalId !== goalId || raw.nodeId !== nodeId || assertIso(raw.createdAt) === "" || assertIso(raw.updatedAt) === "") throw storageError("local Goal node is invalid");
    return raw;
  }

  private async writeGoal(workspace: string, goal: Goal): Promise<void> {
    await atomicWriteJson(goalFile(workspace, goal.goalId), goal, MAX_GOAL_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
  }

  private async writeNode(workspace: string, node: GoalNode): Promise<void> {
    await ensureDirectoryChain(workspace, node.goalId);
    await atomicWriteJson(nodeFile(workspace, node.goalId, node.nodeId), node, MAX_NODE_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
  }

  private async appendEdge(workspace: string, edge: GoalEdge): Promise<void> {
    const key = `${path.resolve(workspace)}\0${edge.goalId}`;
    const previous = this.edgeLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    this.edgeLocks.set(key, tail);
    await previous;
    try {
      const raw = await readJson(edgesFile(workspace, edge.goalId), MAX_EDGE_RECORD_BYTES);
      if (!Array.isArray(raw) || raw.length >= MAX_EDGES || !raw.every(isEdge)) throw storageError("local Goal edges are invalid or exceed their bound");
      await atomicWriteJson(edgesFile(workspace, edge.goalId), [...raw, edge], MAX_EDGE_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
    } finally {
      release();
      if (this.edgeLocks.get(key) === tail) this.edgeLocks.delete(key);
    }
  }

  private async appendActivity(workspace: string, goal: Goal, kind: GoalActivity["kind"], summary: string, nodeId?: string): Promise<void> {
    const directory = path.join(goalDir(workspace, goal.goalId), "activities");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw storageError("local Goal activities are unreadable", error);
    }
    if (entries.length >= MAX_ACTIVITIES) throw storageError("local Goal activity count exceeds its bound");
    const activity: GoalActivity = { schemaVersion: GOAL_ACTIVITY_SCHEMA_VERSION, activityId: crypto.randomUUID(), goalId: goal.goalId, kind, summary: assertText(summary, "activity summary", MAX_TITLE_LENGTH), ...(nodeId !== undefined ? { nodeId } : {}), at: new Date().toISOString() };
    await atomicWriteJson(activityFile(workspace, goal.goalId, activity.activityId), activity, MAX_ACTIVITY_RECORD_BYTES, nodeAtomicTurnWriteOperations, (message) => storageError(message));
  }

  private async readActivities(workspace: string, goal: Goal): Promise<GoalActivity[]> {
    const directory = path.join(goalDir(workspace, goal.goalId), "activities");
    await assertRealDirectory(directory, "local Goal activities are unreadable");
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw storageError("local Goal activities are unreadable", error);
    }
    let temporaryCount = 0;
    const activityEntries = entries.filter((entry) => {
      if (!entry.name.endsWith(".tmp")) return true;
      temporaryCount += 1;
      if (temporaryCount > MAX_GOAL_TEMP_FILES || !entry.isFile() || entry.isSymbolicLink() || !isAtomicGoalTemporaryName(entry.name)) throw storageError("local Goal activities contain an unsafe temporary");
      return false;
    });
    if (activityEntries.length > MAX_ACTIVITIES) throw storageError("local Goal activity count exceeds its bound");
    const activities: GoalActivity[] = [];
    for (const entry of activityEntries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) throw storageError("local Goal activities contain an unsafe entry");
      const raw = await readJson(path.join(directory, entry.name), MAX_ACTIVITY_RECORD_BYTES);
      if (!isActivity(raw) || raw.goalId !== goal.goalId || activityFile(workspace, goal.goalId, raw.activityId) !== path.resolve(path.join(directory, entry.name))) throw storageError("local Goal activity is invalid");
      activities.push(raw);
    }
    return activities;
  }

  private async assertNodeCapacity(workspace: string, goal: Goal): Promise<void> {
    const entries = await fs.readdir(path.join(goalDir(workspace, goal.goalId), "nodes"), { withFileTypes: true }).catch(() => []);
    if (entries.filter((entry) => entry.isFile()).length >= MAX_NODES) throw new OrgApiError(errorCodes.goal_conflict, 409, "Goal reached its bounded node count");
  }

  private readonly edgeLocks = new Map<string, Promise<void>>();

  private async assertGoalCapacity(workspace: string): Promise<void> {
    const root = path.join(workspace, GOALS_ROOT);
    let entries;
    try {
      const stat = await fs.lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError("local Goal root is unreadable");
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (entries.filter((entry) => entry.isDirectory() && GOAL_ID_PATTERN.test(entry.name)).length >= MAX_GOALS) {
      throw new OrgApiError(errorCodes.goal_conflict, 409, "workspace reached its bounded Goal count");
    }
  }
}

async function assertRealDirectory(directory: string, message: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw storageError(message);
    throw storageError(message, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError(message);
}
