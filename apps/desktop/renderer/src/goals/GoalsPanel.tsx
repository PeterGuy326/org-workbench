import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Input, Progress, Tag } from "antd";
import { CheckCircle2, CircleAlert, GitBranch, Network, Plus, Target } from "lucide-react";
import { useT, type OwbT } from "@roleweave/ui";
import type { Goal, GoalEdge, GoalNode, GoalView } from "@roleweave/shared";

interface GoalsPanelProps {
  workspaceOpen: boolean;
  positionNames: Record<string, string>;
  activeGoalId: string | null;
  onActiveGoalChange: (goalId: string | null) => void;
}

const healthIcon = {
  healthy: <CheckCircle2 aria-hidden="true" size={14} />,
  attention: <CircleAlert aria-hidden="true" size={14} />,
  blocked: <CircleAlert aria-hidden="true" size={14} />,
} as const;

export function GoalsPanel({ workspaceOpen, positionNames, activeGoalId, onActiveGoalChange }: GoalsPanelProps) {
  const t = useT();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<GoalView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState("");

  const load = useCallback(async (preferredId?: string | null) => {
    if (!workspaceOpen) {
      setGoals([]);
      setView(null);
      setSelectedId(null);
      return;
    }
    setLoading(true);
    try {
      const response = await window.owb.goals();
      if (response.status !== 200) {
        setError(t("goal.loadFail"));
        return;
      }
      const nextGoals = response.body.goals;
      setGoals(nextGoals);
      const nextId = preferredId && nextGoals.some((goal) => goal.goalId === preferredId)
        ? preferredId
        : activeGoalId && nextGoals.some((goal) => goal.goalId === activeGoalId)
          ? activeGoalId
          : nextGoals[0]?.goalId ?? null;
      setSelectedId(nextId);
      onActiveGoalChange(nextId);
      if (nextId !== null) {
        const detail = await window.owb.goal(nextId);
        setView(detail.status === 200 ? detail.body : null);
      } else {
        setView(null);
      }
      setError(null);
    } catch {
      setError(t("goal.loadFailOffline"));
    } finally {
      setLoading(false);
    }
  }, [activeGoalId, onActiveGoalChange, selectedId, t, workspaceOpen]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const off = window.owb.onEvent((event) => {
      const envelope = event as { type?: string; payload?: { goalId?: string } };
      if (envelope.type === "goal.updated") void load(envelope.payload?.goalId ?? selectedId);
    });
    return off;
  }, [load, selectedId]);

  const select = useCallback(async (goalId: string) => {
    setSelectedId(goalId);
    onActiveGoalChange(goalId);
    const response = await window.owb.goal(goalId);
    if (response.status === 200) setView(response.body);
  }, [onActiveGoalChange]);

  const create = useCallback(async () => {
    const acceptanceCriteria = criteria.split("\n").map((item) => item.trim()).filter(Boolean);
    if (title.trim().length === 0 || acceptanceCriteria.length === 0) return;
    setCreating(true);
    try {
      const response = await window.owb.createGoal({ title, description, acceptanceCriteria });
      if (response.status === 201) {
        setTitle("");
        setDescription("");
        setCriteria("");
        setCreating(false);
        await load(response.body.goalId);
        return;
      }
      setError(t("goal.createFail"));
    } catch {
      setError(t("goal.createFail"));
    } finally {
      setCreating(false);
    }
  }, [criteria, description, load, t, title]);

  const markCriterion = useCallback(async (criterionId: string, status: "open" | "met") => {
    if (selectedId === null) return;
    const response = await window.owb.updateGoal({ goalId: selectedId, update: { criterionId, criterionStatus: status } });
    if (response.status === 200) await load(selectedId);
  }, [load, selectedId]);

  return (
    <section className="owb-goals" aria-label={t("goal.moduleAria")}>
      <header className="owb-goals__header">
        <div>
          <p className="owb-kicker"><Target aria-hidden="true" size={13} /> {t("goal.title")}</p>
          <h1>{t("goal.title")}</h1>
          <p>{t("goal.subtitle")}</p>
        </div>
        <Button type="primary" icon={<Plus aria-hidden="true" size={14} />} onClick={() => setCreating((current) => !current)} disabled={!workspaceOpen}>
          {t("goal.create")}
        </Button>
      </header>
      {error ? <p className="owb-goals__error" role="alert">{error}</p> : null}
      {creating ? (
        <div className="owb-goals__create" aria-label={t("goal.create")}>
          <Input placeholder={t("goal.newTitle")} value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input.TextArea placeholder={t("goal.newDescription")} value={description} onChange={(event) => setDescription(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} />
          <Input.TextArea placeholder={t("goal.newCriteria")} value={criteria} onChange={(event) => setCriteria(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} />
          <Button type="primary" onClick={() => void create()} loading={creating}>{t("goal.createSubmit")}</Button>
        </div>
      ) : null}
      {!workspaceOpen ? <p className="owb-muted">{t("turn.emptyOpenFirst")}</p> : goals.length === 0 && !loading ? <p className="owb-goals__empty">{t("goal.none")}</p> : (
        <div className="owb-goals__body">
          <nav className="owb-goals__list" aria-label={t("goal.title")}>
            {goals.map((goal) => (
              <button type="button" key={goal.goalId} className={goal.goalId === selectedId ? "is-active" : ""} onClick={() => void select(goal.goalId)}>
                <span>{goal.title}</span><small>{goal.status}</small>
              </button>
            ))}
          </nav>
          {view ? <GoalDetail view={view} positionNames={positionNames} onCriterion={markCriterion} t={t} /> : <p className="owb-goals__empty">{t("goal.select")}</p>}
        </div>
      )}
    </section>
  );
}

function GoalDetail({ view, positionNames, onCriterion, t }: { view: GoalView; positionNames: Record<string, string>; onCriterion: (criterionId: string, status: "open" | "met") => Promise<void>; t: OwbT }) {
  const { goal, state } = view;
  const branchNodes = view.nodes.filter((node) => node.kind !== "goal");
  return (
    <article className="owb-goals__detail">
      <div className="owb-goals__detail-title">
        <div><span className="owb-kicker"><Network aria-hidden="true" size={13} /> {goal.status}</span><h2>{goal.title}</h2><p>{goal.description || t("goal.subtitle")}</p></div>
        <Tag className={`owb-goal-health owb-goal-health--${state.health}`}>{healthIcon[state.health]} {t(`goal.${state.health}`)}</Tag>
      </div>
      <div className="owb-goals__metrics">
        <Metric label={t("goal.progress")} value={`${state.progress.percent}%`}><Progress percent={state.progress.percent} showInfo={false} strokeColor="var(--ui-primary)" /></Metric>
        <Metric label={t("goal.branches")} value={`${state.activeNodeCount} ${t("goal.active")} / ${branchNodes.length}`} />
        <Metric label={t("goal.agents")} value={state.assignedPositionIds.map((id) => positionNames[id] ?? id).join(", ") || "—"} />
      </div>
      <div className="owb-goals__next-action"><span>{t("goal.nextAction")}</span><strong>{state.nextAction ?? "—"}</strong></div>
      <section className="owb-goals__criteria" aria-label={t("goal.progress")}>
        <h3>{t("goal.progress")}</h3>
        {goal.acceptanceCriteria.map((criterion) => (
          <button type="button" key={criterion.criterionId} className={criterion.status === "met" ? "is-met" : ""} onClick={() => void onCriterion(criterion.criterionId, criterion.status === "met" ? "open" : "met")}>
            <span aria-hidden="true">{criterion.status === "met" ? "✓" : "○"}</span><span>{criterion.title}</span><small>{criterion.status}</small>
          </button>
        ))}
      </section>
      <section className="owb-goals__graph" aria-label={t("goal.graphPreview")}>
        <div className="owb-goals__section-heading"><h3><GitBranch aria-hidden="true" size={14} /> {t("goal.graphPreview")}</h3><span>{t("goal.graphHint")}</span></div>
        <GoalGraph3D nodes={view.nodes} edges={view.edges} positionNames={positionNames} />
      </section>
      <section className="owb-goals__activity" aria-label={t("goal.timeline")}>
        <h3>{t("goal.timeline")}</h3>
        {view.activities.slice(-8).reverse().map((activity) => <div className="owb-goals__activity-row" key={activity.activityId}><time>{new Date(activity.at).toLocaleTimeString()}</time><span>{activity.summary}</span></div>)}
      </section>
    </article>
  );
}

function Metric({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return <div className="owb-goals__metric"><span>{label}</span><strong>{value}</strong>{children}</div>;
}

function GoalGraph3D({ nodes, edges, positionNames }: { nodes: GoalNode[]; edges: GoalEdge[]; positionNames: Record<string, string> }) {
  const lifecycleProgress: Record<GoalNode["status"], number> = { planned: 0.08, active: 0.38, indeterminate: 0.56, blocked: 0.62, failed: 0.72, cancelled: 0.18, completed: 0.94 };
  const depth = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const memo = new Map<string, number>();
    const visit = (node: GoalNode): number => {
      const cached = memo.get(node.nodeId);
      if (cached !== undefined) return cached;
      const value = node.parentNodeId === null ? 0 : (visit(byId.get(node.parentNodeId) ?? node) + 1);
      memo.set(node.nodeId, value);
      return value;
    };
    nodes.forEach(visit);
    return memo;
  }, [nodes]);
  const points = new Map(nodes.map((node, index) => {
    const lane = node.positionId ? Object.keys(positionNames).indexOf(node.positionId) : index;
    return [node.nodeId, {
      x: node.kind === "goal" ? 4 : Math.round(lifecycleProgress[node.status] * 86),
      y: depth.get(node.nodeId)! * 58 + (index % 3) * 22 + 18,
      z: Math.max(0, lane) * 12,
    }];
  }));
  const visibleEdges = edges.filter((edge) => points.has(edge.fromNodeId) && points.has(edge.toNodeId));
  const worldHeight = Math.max(235, ...[...points.values()].map((point) => point.y + 52));
  return <div className="owb-goal-graph"><div className="owb-goal-graph__world" style={{ "--goal-world-height": `${worldHeight}px` } as CSSProperties}>
    <svg className="owb-goal-graph__edges" viewBox={`0 0 100 ${worldHeight}`} preserveAspectRatio="none" aria-hidden="true">
      {visibleEdges.map((edge) => {
        const from = points.get(edge.fromNodeId)!;
        const to = points.get(edge.toNodeId)!;
        return <line className={`owb-goal-graph__edge owb-goal-graph__edge--${edge.kind}`} key={edge.edgeId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
      })}
    </svg>
    {nodes.map((node) => {
      const point = points.get(node.nodeId)!;
      const style = { "--goal-x": `${point.x}%`, "--goal-y": `${point.y}px`, "--goal-z": `${point.z}px` } as CSSProperties;
      return <div className={`owb-goal-node owb-goal-node--${node.status}`} style={style} key={node.nodeId} title={node.positionId ? positionNames[node.positionId] ?? node.positionId : undefined}><span>{node.kind}</span><strong>{node.label}</strong>{node.positionId ? <small>{positionNames[node.positionId] ?? node.positionId}</small> : null}</div>;
    })}
  </div></div>;
}
