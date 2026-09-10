/**
 * Goal-centered collaboration contracts.
 *
 * A Goal is the operator-owned outcome. Turns, groups and sessions remain
 * execution primitives; this additive graph contract gives them a durable
 * local binding without changing the upstream engine envelope.
 */

import type { TurnEngine } from "./turns.js";

export const GOAL_SCHEMA_VERSION = "goal.v1" as const;
export const GOAL_LIST_SCHEMA_VERSION = "goal-list.v1" as const;
export const GOAL_NODE_SCHEMA_VERSION = "goal-node.v1" as const;
export const GOAL_EDGE_SCHEMA_VERSION = "goal-edge.v1" as const;
export const GOAL_ACTIVITY_SCHEMA_VERSION = "goal-activity.v1" as const;
export const GOAL_VIEW_SCHEMA_VERSION = "goal-view.v1" as const;

export const goalStatuses = ["active", "paused", "completed", "abandoned"] as const;
export type GoalStatus = (typeof goalStatuses)[number];

export const goalCriterionStatuses = ["open", "met", "blocked"] as const;
export type GoalCriterionStatus = (typeof goalCriterionStatuses)[number];

export const goalNodeKinds = [
  "goal",
  "milestone",
  "task",
  "agent",
  "turn",
  "artifact",
  "blocker",
  "handoff",
] as const;
export type GoalNodeKind = (typeof goalNodeKinds)[number];

export const goalNodeStatuses = [
  "planned",
  "active",
  "completed",
  "failed",
  "blocked",
  "indeterminate",
  "cancelled",
] as const;
export type GoalNodeStatus = (typeof goalNodeStatuses)[number];

export const goalEdgeKinds = [
  "contains",
  "assigned",
  "participates",
  "depends_on",
  "produces",
  "supports",
  "blocked_by",
  "handoff_to",
] as const;
export type GoalEdgeKind = (typeof goalEdgeKinds)[number];

export interface GoalAcceptanceCriterion {
  criterionId: string;
  title: string;
  weight: number;
  status: GoalCriterionStatus;
}

export interface Goal {
  schemaVersion: typeof GOAL_SCHEMA_VERSION;
  goalId: string;
  title: string;
  description: string;
  status: GoalStatus;
  acceptanceCriteria: GoalAcceptanceCriterion[];
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalNode {
  schemaVersion: typeof GOAL_NODE_SCHEMA_VERSION;
  nodeId: string;
  goalId: string;
  kind: GoalNodeKind;
  label: string;
  status: GoalNodeStatus;
  parentNodeId: string | null;
  positionId?: string;
  engine?: TurnEngine;
  sessionId?: string;
  conversationRef?: string;
  turnId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalEdge {
  schemaVersion: typeof GOAL_EDGE_SCHEMA_VERSION;
  edgeId: string;
  goalId: string;
  kind: GoalEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  createdAt: string;
}

export type GoalActivityKind =
  | "goal.created"
  | "goal.updated"
  | "node.created"
  | "node.updated";

export interface GoalActivity {
  schemaVersion: typeof GOAL_ACTIVITY_SCHEMA_VERSION;
  activityId: string;
  goalId: string;
  kind: GoalActivityKind;
  summary: string;
  nodeId?: string;
  at: string;
}

export interface GoalList {
  schemaVersion: typeof GOAL_LIST_SCHEMA_VERSION;
  goals: Goal[];
}

export type GoalHealth = "healthy" | "attention" | "blocked";

export interface GoalState {
  progress: {
    completedWeight: number;
    totalWeight: number;
    percent: number;
  };
  health: GoalHealth;
  activeNodeCount: number;
  completedNodeCount: number;
  failedNodeCount: number;
  blockedNodeCount: number;
  indeterminateNodeCount: number;
  assignedPositionIds: string[];
  nextAction: string | null;
}

export interface GoalView {
  schemaVersion: typeof GOAL_VIEW_SCHEMA_VERSION;
  goal: Goal;
  nodes: GoalNode[];
  edges: GoalEdge[];
  activities: GoalActivity[];
  state: GoalState;
}
