# cc-nexs 架构

## 设计目标

把 本预设 SOP 从 monolith CLAUDE.md 拆成可独立加载、按状态自动衔接的原子组件，达成三个核心特性：

1. **状态机驱动的自循环**：阶段完成自动进入下一阶段，零等待
2. **唯一人工 checkpoint**：仅在 spec 通过 SA 评审后停一次，避免在错误方向上累积浪费
3. **五方异构身份隔离**：Planner / Tech Lead / SA / QA / Evaluator 五角色，跨工具（Claude × 2 + Codex × 3）+ session 级隔离

## 状态机

```
                          ┌────────────┐
                          │    INIT    │
                          └──────┬─────┘
                                 │ requirements.md 已填
                                 ▼
                          ┌────────────┐
                          │ REQ_DRAFTED│
                          └──────┬─────┘
                                 │ /cc-nexs:planner
                                 ▼
                          ┌────────────┐  ◄────────────┐
                          │SPEC_DRAFTED│               │ 修订
                          └──────┬─────┘               │
                                 │ /cc-nexs:sa spec    │
                                 ▼                     │
                          ┌────────────┐               │
                          │SPEC_REVIEW │───────────────┤
                          └──────┬─────┘ NEEDS_REVISION
                                 │ PASS
                                 ▼
              ┌────────────────────────────────────────┐
              │  ⏸️  SPEC_PENDING_HUMAN  (唯一人工 gate) │
              └─────────────────────┬──────────────────┘
                                    │ /cc-nexs:approve-spec
                                    ▼
                          ┌──────────────────┐
                          │  SPEC_APPROVED   │
                          └────────┬─────────┘
                                   │ for N in 1..total_sprints
                                   ▼
                ┌──────────────────────────────────┐
                │     SPRINT_<N>_KICKOFF           │
                └──┬───────────────────────────────┘
                   │ ┌────────────┐
                   ├─┤ QA_CASES   │ QA 写本 sprint 用例
                   │ └─────┬──────┘
                   │       │
                   ▼       ▼
                ┌─────────────────┐
                │  SPRINT_<N>_DEV │ Tech Lead 编码
                └────────┬────────┘
                         ▼
                ┌──────────────────────┐
                │ SA_TEST_REVIEW       │ SA 评审用例
                └────────┬─────────────┘
                         ▼
                ┌──────────────────────┐
                │  DOC_SYNC            │ 同步 api/deploy
                └────────┬─────────────┘
                         ▼
                ┌──────────────────────┐  ◄────┐
                │ SA_CODE              │       │ NEEDS_REVISION
                └────────┬─────────────┘──────┤  (sa_code_revision_count++)
                         │ PASS                │
                         ▼                     │
                ┌──────────────────────┐       │
                │ QA_RUN               │ 有 BUG│
                └────────┬─────────────┘──────►├───┐
                         │ 无 BUG               │   │
                         │                      │   ▼
                         │                  ┌──────────┐
                         │                  │   FIX    │ Tech Lead 修
                         │                  └────┬─────┘
                         │                       ▼
                         │                  ┌────────────────┐
                         │                  │ QA_REGRESSION  │
                         │                  └────┬───────────┘
                         │                       │ 通过
                         │                       │
                         ▼                       ▼
                ┌──────────────────────┐
                │ EVAL                 │ Evaluator 契约打分
                └────────┬─────────────┘
                         │ 通过
                         ▼
                ┌──────────────────────┐
                │ SPRINT_<N>_DONE      │
                └────────┬─────────────┘
                         │
                ┌────────┴────────┐
                │                 │
              N+1 还有          全部完
                │                 │
                ▼                 ▼
       SPRINT_<N+1>_KICKOFF   ALL_SPRINTS_DONE
                                  │
                                  ▼
                           FINAL_EVAL
                                  │ 通过
                                  ▼
                           ┌──────────────┐
                           │   COMPLETE   │
                           └──────────────┘
```

## 三档熔断

| 熔断器 | 阈值 | 触发后 |
|--------|------|--------|
| `sa_code_revision_count` | ≥ 3 | 升级回 `SPEC_REVIEWING`，强制 Planner 重审方案，spec.md 变更记录写明熔断 |
| `qa_fix_count[BUG-<id>]` | ≥ 3 | 升级到 `SPRINT_<N>_TECH_LEAD_REVIEW`，对应 BUG 升级 P0，Tech Lead 重评实现路径 |
| `evaluator_未通过_count` | ≥ 2 | 升级回 `SPEC_REVIEWING`，AC 写得有问题或实现严重偏离 |

熔断不是终点，是 *升级*——把决策从低层（修代码）抬到高层（改方案/改契约）。

## 五方身份矩阵

详见 [`role-map.md`](./role-map.md)。要点：

- 同 Claude 工具的两个角色（Planner / Tech Lead）必须分两个独立 session
- 同 Codex 工具的三个角色（SA / QA / Evaluator）每次都用独立调用
- 每个角色 prompt 开头声明身份，hooks 通过 `CC_NEXS_ROLE` 环境变量做硬拦截

## 编排器

`/cc-nexs:run` 是核心 orchestrator，行为：

1. 读 `progress.md.current_state`
2. 按状态分派表调起对应 command
3. 等待 command 完成 → 解析输出 → 写新状态
4. 检查熔断阈值
5. **立即** 回到 1，自循环
6. **唯一例外**：`SPEC_PENDING_HUMAN` 时 return 等人工

## 数据流

```
PM 业务需求
    │
    ▼
requirements.md (PM 写)
    │
    ▼ Planner
spec.md (含 AC 表 + Sprint 切片)
    │
    ├─→ SA → sa-review.md
    │
    ├─→ ⏸️ 人工审 spec
    │
    └─→ for each Sprint:
            ├─→ Planner spec.md (AC 子集)
            │       │
            │       ├─→ QA → test-cases.md
            │       │       └─→ SA → sa-test-review.md
            │       │
            │       └─→ Tech Lead → src/* + dev-plan.md + api-doc.md + deploy.md
            │               └─→ SA → sa-code-review.md
            │                       └─→ QA → test-report.md + bugs/
            │                               └─→ Tech Lead 修 → bugs/.状态=FIXED
            │                                       └─→ QA 回归 → bugs/.状态=VERIFIED
            │
            └─→ Evaluator → acceptance.md (sprint 章节)
    │
    ▼
Evaluator → acceptance.md (最终章节)
    │
    ▼
COMPLETE → 人工合并到 main
```

## Hooks 防线

三道 PreToolUse hook：

1. **role-boundary-guard.sh** — 通过 `CC_NEXS_ROLE` 拦截身份越界（Planner 编辑 src/、Tech Lead 改 spec.md 等）
2. **spec-gate-guard.sh** — `SPEC_PENDING_HUMAN` 状态下拦截推进性命令（codex/mvn/git commit/git push）
3. **pre-merge-check.sh** — 合并主干前强制检查 mvn compile + 中文字符串 + progress.md COMPLETE + acceptance.md 通过

hook 是最后一道安全网，主防线在身份 prompt 和 orchestrator 的状态机。

## 与 monolith CLAUDE.md 的对比

| 维度 | monolith CLAUDE.md | cc-nexs |
|------|--------------------|---------|
| 加载方式 | 整个 700+ 行始终在上下文 | 按阶段加载，每次只占用当前阶段相关内容 |
| 阶段衔接 | Claude 自记忆"当前到哪步" | progress.md 状态机持久化，不健忘 |
| 越界控制 | 靠 prompt 提醒 | hooks 硬拦截 + 身份 prompt + session 隔离 |
| 熔断 | 文档描述无机制 | 计数器 + 阈值，自动升级 |
| 复用 | 整套绑死 | 各组件可单独触发 / 借鉴 |

## fast 模式（0.3.0+）

单 sprint 三角色合并流水线。比 full 模式少 ~50% 子代理调用。由 `all-docs/doc/<id>/config.json.mode = "fast"` 触发。

### 状态机

```
INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING ──┐
                                                      │ NEEDS_REVISION
                                                      ▼
                              ┌────────────────────────────┐
                              │  SPEC_PENDING_HUMAN  ⏸️    │
                              └──────────────┬─────────────┘
                                             ▼
                                       SPEC_APPROVED
                                             │
                                             ▼
                                      ┌──────────┐ ◄────┐
                                      │  BUILD   │      │ ACCEPT_NEEDS_REVISION
                                      └────┬─────┘      │
                                           ▼            │
                                      ┌──────────┐      │
                                      │   TEST   │      │
                                      └────┬─────┘      │
                                  阻塞 │    │ 通过       │
                                       ▼    ▼            │
                              ┌──────────┐  TEST_PASSED  │
                              │   FIX    │      │        │
                              └────┬─────┘      │        │
                                   ▼            │        │
                              ┌────────────┐    │        │
                              │REGRESSION  │────┘        │
                              └────────────┘             │
                                       │                 │
                                       ▼                 │
                                   ┌──────────┐          │
                                   │  ACCEPT  │──────────┘ 代码 NEEDS_REVISION
                                   └────┬─────┘            或 验收未通过
                                        │ 全 PASS
                                        ▼
                                   ┌──────────┐
                                   │ COMPLETE │
                                   └──────────┘
```

### 三角色对照

| full 角色 | fast 等价物 | 合并差异 |
|---|---|---|
| Planner + Tech Lead | **Fullstack** | 同 session 写 spec + 写代码（但仍要先写完五章节才能开 src/） |
| SA 评审 spec | **Reviewer** target=spec | 同名输出 sa-review.md |
| SA 评审代码 + Evaluator 契约打分 | **Reviewer** target=accept | 单次 codex 同时产 sa-code-review.md + acceptance.md |
| QA cases + run + regression | **Verifier** initial / regression | initial 一次产 test-cases.md + test-report.md |

### 熔断（更严）

| 熔断器 | 阈值 | 触发后 |
|---|---|---|
| review_revision | ≥ 2 | 回 SPEC_REVIEWING，Fullstack 重写方案 |
| evaluator_reject | ≥ 2 | 回 SPEC_REVIEWING，重审 AC 与实现路径 |
| fix_per_bug | ≥ 2 | **HUMAN_INTERVENTION**：直接停下要人工介入（fast 模式没有 TECH_LEAD_REVIEW 兜底岗）|

### 何时用 fast

| 用 full | 用 fast |
|---|---|
| 跨模块、含 DB schema 变更 | 单模块单接口 |
| 涉及对外契约、合规风险 | 改动 ≤ 800 行 diff |
| Sprint 切片 ≥ 2 | 无并发/事务复杂度 |

## 取舍声明

v0.1.0 **不做**：

- 自动 git worktree 隔离（用户用现有 feature 分支）
- 自动 learning pipeline（先用 项目 tasks/lessons.md 静态写）
- 流水线模式自动切换（用户改 config.json.mode 触发）
- 30+ hooks 全套（先做 3 个核心 hook）
- 自定义 marketplace 发布（先本地 link）

这些放 v0.2+ 视使用反馈再决定。
