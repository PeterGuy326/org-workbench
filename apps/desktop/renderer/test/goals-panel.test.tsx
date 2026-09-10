import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Goal, GoalView } from "@roleweave/shared";
import { GoalsPanel } from "../src/goals/GoalsPanel";

const goalId = "11111111-1111-4111-8111-111111111111";
const rootNodeId = "22222222-2222-4222-8222-222222222222";
const taskNodeId = "33333333-3333-4333-8333-333333333333";
const edgeId = "44444444-4444-4444-8444-444444444444";

function fixture(): { goal: Goal; view: GoalView } {
  const goal: Goal = {
    schemaVersion: "goal.v1",
    goalId,
    title: "Ship the collaboration spine",
    description: "Keep every branch attached to one user-owned outcome.",
    status: "active",
    acceptanceCriteria: [{ criterionId: "criterion-1", title: "Evidence is visible", weight: 1, status: "open" }],
    rootNodeId,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  return {
    goal,
    view: {
      schemaVersion: "goal-view.v1",
      goal,
      nodes: [
        { schemaVersion: "goal-node.v1", nodeId: rootNodeId, goalId, kind: "goal", label: goal.title, status: "active", parentNodeId: null, createdAt: goal.createdAt, updatedAt: goal.updatedAt },
        { schemaVersion: "goal-node.v1", nodeId: taskNodeId, goalId, kind: "task", label: "Review evidence", status: "active", parentNodeId: rootNodeId, positionId: "agent-1", createdAt: goal.createdAt, updatedAt: goal.updatedAt },
      ],
      edges: [{ schemaVersion: "goal-edge.v1", edgeId, goalId, kind: "contains", fromNodeId: rootNodeId, toNodeId: taskNodeId, createdAt: goal.createdAt }],
      activities: [{ schemaVersion: "goal-activity.v1", activityId: "55555555-5555-4555-8555-555555555555", goalId, kind: "goal.created", summary: "Created Goal: Ship the collaboration spine", at: goal.createdAt }],
      state: { progress: { completedWeight: 0, totalWeight: 1, percent: 0 }, health: "healthy", activeNodeCount: 1, completedNodeCount: 0, failedNodeCount: 0, blockedNodeCount: 0, indeterminateNodeCount: 0, assignedPositionIds: ["agent-1"], nextAction: "Monitor active branches" },
    },
  };
}

describe("GoalsPanel", () => {
  it("renders global state, a connected graph edge, and updates acceptance criteria", async () => {
    const { goal, view } = fixture();
    const bridge = {
      goals: vi.fn().mockResolvedValue({ status: 200, body: { schemaVersion: "goal-list.v1", goals: [goal] } }),
      goal: vi.fn().mockResolvedValue({ status: 200, body: view }),
      updateGoal: vi.fn().mockResolvedValue({ status: 200, body: goal }),
      onEvent: vi.fn().mockReturnValue(() => undefined),
    };
    Object.defineProperty(window, "owb", { configurable: true, value: bridge });

    const activeGoalChange = vi.fn();
    const { container } = render(<GoalsPanel workspaceOpen positionNames={{ "agent-1": "Research agent" }} activeGoalId={null} onActiveGoalChange={activeGoalChange} />);

    expect(await screen.findByRole("heading", { name: "目标主线", level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText("Ship the collaboration spine")).toHaveLength(3);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("Monitor active branches")).toBeInTheDocument();
    expect(screen.getAllByText("Research agent")).toHaveLength(2);
    expect(container.querySelectorAll(".owb-goal-graph__edge")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Evidence is visible/ }));
    await waitFor(() => expect(bridge.updateGoal).toHaveBeenCalledWith({ goalId, update: { criterionId: "criterion-1", criterionStatus: "met" } }));
  });
});
