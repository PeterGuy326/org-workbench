# Goal spine v1

状态：Issue #222 的第一条可验证垂直切片。

## 价值

Goal 是用户定义的结果，不是某个 Agent 的一次运行。把 Goal 固定为多 Agent 协作的主线，可以让工作台回答四个问题：

1. 所有 Agent 当前在为哪个结果工作？
2. 哪些分支已完成、失败、阻塞或仍待确认？
3. 每个分支由谁、在哪个 session/group/turn 中执行？
4. 用户的验收标准是否已经有足够证据完成？

这解决的是跨 session、群组并行/接力和工作区重启后的上下文断裂。三维视图是这个状态的导航方式，不是价值本身。

## 模型

```text
Goal
 └─ contains → milestone/task
                  ├─ assigned → position/Agent
                  ├─ participates → session/group/turn
                  ├─ produces → artifact
                  └─ blocked_by / handoff_to → another branch
```

第一切片落地了 Goal、task/milestone 节点、contains 边和 activity；turn 记录额外保存 `goalId`/`goalNodeId`，不改变上游 engine envelope。

Goal 状态由用户显式更新，验收标准按权重形成进度。Goal 只有在全部验收标准为 `met` 时才能进入 `completed`，引擎的 `run.completed` 不等于 Goal 完成。

## 三维投影

图数据使用三条稳定语义轴：

- X：工作进展和生命周期；
- Y：从 Goal 根节点向下的分支/依赖深度；
- Z：Agent/岗位 lane，表示协作位置。

渲染器可以先用二维 fallback，再用透视/`translate3d` 表达三维关系。坐标必须由持久化图确定，不能由每次渲染的随机力导布局替代，以便刷新、重启和截图验收保持稳定。

## 边界

- Goal 数据只落在当前 workspace 的 `.digital-employee/workbench/goals/`，目录 0700、记录 0600、原子写入并拒绝符号链接。
- Goal 只做工作台的本地控制面投影；不把 Goal 元数据塞入 engine envelope，也不跨工作区猜测归属。
- `completed`、`failed`、`indeterminate` 是执行分支证据；它们只能推动全局状态，不能自动篡改验收标准。
- 自动分解、远程图数据库、跨用户同步、市场化编排不在本切片内。
