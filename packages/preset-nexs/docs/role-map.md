# 角色身份矩阵

cc-nexs 按 `config.json.mode` 选择两套角色：
- **full 模式**：五方异构 + 现状勘察（Repo Scout / Planner / Tech Lead / SA / QA / Evaluator）
- **fast 模式**：三角色合并（Fullstack / Reviewer / Verifier）—— recon 折叠到 Fullstack `--phase=spec` 内部，见文末

## full 模式：矩阵速查

| 维度 | Repo Scout | Planner | Tech Lead | SA | QA | Evaluator |
|------|-----------|---------|-----------|----|----|-----------|
| **工具** | Claude | Claude | Claude | Codex CLI | Codex CLI | Codex CLI |
| **Session** | 独立 | 独立 | 独立 | 每次新调用 | 每次新调用 | 每次新调用 |
| **入口 command** | `/cc-nexs:recon` | `/cc-nexs:planner` | `/cc-nexs:dev` | `/cc-nexs:sa` | `/cc-nexs:qa` | `/cc-nexs:evaluator` |
| **agent 文件** | `agents/repo-scout-claude.md` | `agents/planner-claude.md` | `agents/tech-lead-claude.md` | `agents/sa-codex.md` | `agents/qa-codex.md` | `agents/evaluator-codex.md` |
| **职责** | 扫 src/ 同类配置/Service/页面 → repo-context.md | 业务需求 + 现状清单 → spec.md（AC + Sprint 切片）| 实现代码、修 bug、同步部署文档 | 评审 spec/用例/代码 | 黑盒测试与回归 | 按契约逐条打分验收 |
| **可读** | requirements.md, **src/（只读）**, cc-nexs.config.yml | requirements.md, **repo-context.md**, spec.md, sa-review.md | spec.md, sa-code-review.md, src/, bugs/, dev-plan.md | spec.md, test-cases.md, code diff | spec.md, api-doc.md, test-cases.md, sa-test-review.md（仅修订时）| spec.md, test-report.md, acceptance.md, bugs/（VERIFIED）|
| **可写** | repo-context.md | spec.md | src/, dev-plan.md, deploy.md, api-doc.md, bugs/<id>.md | sa-review.md, sa-test-review.md, sa-code-review.md | test-cases.md, test-report.md, bugs/, qa-scripts/ | acceptance.md |
| **禁读** | spec/sa-*/acceptance/test-*（后续阶段产物）| **src/**, sa-code-review.md, sa-test-review.md, qa-*, acceptance.md | acceptance.md（参考可，不依赖）, sa-review.md, sa-test-review.md, test-report.md（自己写过的部分除外）| — | **src/, sa-review.md, sa-code-review.md, dev-plan.md, acceptance.md** | **src/, sa-*.md, dev-plan.md, qa-scripts/** |
| **禁写** | src/, spec.md, progress.md, 任何代码 | src/, progress.md, sa-*.md, acceptance.md, test-* | spec.md, acceptance.md, sa-*.md, test-report.md, progress.md | 代码, spec.md, 其他角色的 md | src/, sa-*.md, spec.md | spec.md, sa-*.md, test-report.md, src/ |

## 四条黄金纪律

### 0. Planner 禁读 src/，但通过 Repo Scout 间接知道现状

Planner 仍**禁读 src/**——这是身份隔离的基础。但为了避免 Planner 在真空里设计 spec，引入 **Repo Scout** 作为前置勘察员：

- Repo Scout 可以读 src/，但**只能**产出 `all-docs/doc/<id>/repo-context.md`（事实清单），不能写 spec/code/progress.md
- Planner 必读 repo-context.md（与 requirements.md 同级）
- Planner 看到的是 Repo Scout 浓缩过的事实清单，已不是代码

为什么需要 Repo Scout：以前 Planner 在真空里设计 spec 经常忽略既有 Service / 表 / 页面，导致 SA 反复返工。Repo Scout 把这步前移到 spec 起草前。

### 1. Planner 不写代码，Tech Lead 不改契约

二者都用 Claude，但是**两个独立 session**。session 的 prompt 开头必须显式声明身份。

发现需要破规：

- Planner 想动手实现 → 立刻停手，让 orchestrator 切到 Tech Lead session
- Tech Lead 想改 spec.md / AC → 立刻停手，按 §六 走需求变更流程，回 Planner

### 2. QA 是黑盒，Evaluator 更黑盒

| 角色 | 黑盒级别 |
|------|---------|
| QA | 不读 src/、不读 sa-review.md / sa-code-review.md。例外：写测试用例时允许读 sa-test-review.md（修订）|
| Evaluator | QA 之上再加一层。**连 sa-test-review.md 都不读**。只看 spec + test-report + bugs（VERIFIED） |

为什么 Evaluator 更严：QA 跑测试要靠测试用例，免不了要按 SA 反馈修测试；Evaluator 是验收人，必须从纯业务契约视角判，受任何技术评审影响都会污染。

### 3. 执行人 ≠ 验收人

QA 跑测试 → test-report.md（执行记录）
Evaluator 按契约打分 → acceptance.md（验收结论）

两者**绝不能**是同一 codex 调用。如果合并：QA 自然倾向于"测过的就当过"，验收变成走过场。

实现层面：

- QA 用 `codex` 的 prompt 开头声明身份 = QA
- Evaluator 用**另一个 `codex`** 的 prompt 声明身份 = Evaluator
- 两次调用 stdin / stdout 互不相通

## 越界检测

### prompt 层

每个 agent 文件开头都列出禁令清单。Claude 读 agent 时优先看到禁令。

### hooks 层

`hooks/role-boundary-guard.sh` 在 PreToolUse 拦截。识别身份靠环境变量：

```bash
CC_NEXS_ROLE=planner-claude    # Planner session 启动时设置
CC_NEXS_ROLE=tech-lead-claude  # Tech Lead session 启动时设置
# Codex 类无需设置（codex CLI 由命令本体保证身份）
```

orchestrator 的 commands 在调起子代理时通过 prompt 显式声明 + 通过 Bash 环境变量传递。

### SA review 层

SA 在评审代码 diff 时，会检查"这个 commit 是不是 Tech Lead 角色应该做的事"——比如 commit 改了 spec.md 同时改了代码，就是越界，P0 打回。

## 旁路角色：Compound（不进状态机循环）

`Compound` 是状态机**外**的角色，由 `/cc-nexs:compound <id>` 显式触发，不参与 INIT → ... → COMPLETE 循环。

| 维度 | Compound |
|------|---------|
| **工具** | Claude |
| **Session** | 独立 |
| **入口 command** | `/cc-nexs:compound`（旁路，不入状态机） |
| **agent 文件** | `agents/compound-claude.md` |
| **职责** | 读完成需求 all-docs/doc/<id>/* 把"非显然教训"沉淀到 `docs/solutions/<topic>.md` |
| **可读** | all-docs/doc/<id>/ 全部文档（spec / sa-* / bugs / test-report / acceptance / repo-context / progress）+ 既有 docs/solutions/*.md |
| **可写** | docs/solutions/<topic>.md（新建或 Edit）+ all-docs/doc/<id>/compound-summary.md |
| **禁写** | spec / src/ / progress / sa-*.md / acceptance / 任何 all-docs/doc/<id>/ 历史档案 |

**强信号过滤**——必须满足以下任一才允许产出 solution，否则在 compound-summary.md 写"跳过"：
1. 同 BUG 修 ≥ 2 次
2. 同类 SA 反馈跨 ≥ 2 个 sprint
3. RECON 现状假设被推翻
4. 验收 ≥ 1 次未通过
5. spec.md 变更记录 ≥ 3 行

**为什么旁路**：(a) 不是每次需求都有非显然教训，强制反而产噪音；(b) 支持回溯历史需求（`--force`）；(c) 状态机改动越少越稳。

**复利路径**：本次 compound 写 `docs/solutions/<slug>.md` → 下次需求 RECON 阶段 Repo Scout grep 命中 → 摘进 repo-context.md `## 7.6 既往教训命中` → Planner 第一稿就避坑。这是 cc-nexs 复利的字面定义。

## 切换身份

不是简单"我现在切到 X 身份"，而是**结束当前 session、由 orchestrator 起新 session**。

例如 Tech Lead 在编码时发现 AC 写错了：

```
[Tech Lead session]
> ⚠️ 发现 AC-003 描述与实现冲突。停手。
> 修复路径：需要 Planner 修订 spec.md。
> 不在本 session 修改 spec.md。
> 退出。

[orchestrator]
> 检测到 SA 评审 NEEDS_REVISION 或 Tech Lead 报 spec 问题
> 状态机推进 → SPEC_REVIEWING
> 起新 Claude session，身份 = Planner
> Planner session 读 sa-review.md（包含 Tech Lead 报告的问题）→ 修订 spec.md
```

## Hotfix 例外

§十 hotfix P2/P3 流程下，**Tech Lead 允许**写复现脚本（本职是 QA 的活）。这是为了让小 bug 修复链路尽量短。

但 hotfix P0/P1 必须升级为完整流程的子集：Tech Lead 写复现 → SA 轻量评审 → Evaluator 局部打分（仍要拉起 Evaluator codex 调用）。

## 五方在 progress.md 中的痕迹

每次状态转移由 orchestrator 在"历史轨迹"段 append 一行：

```
- 2026-05-17T10:23:45 SPEC_DRAFTED → SPEC_REVIEWING  调用 sa-codex
- 2026-05-17T10:25:12 SPEC_REVIEWING → SPEC_PENDING_HUMAN  sa-review.md PASS
- 2026-05-17T11:02:00 SPEC_PENDING_HUMAN → SPEC_APPROVED  人工放行 (lee)
- 2026-05-17T11:02:30 SPEC_APPROVED → SPRINT_1_KICKOFF
- 2026-05-17T11:15:00 SPRINT_1_KICKOFF → SPRINT_1_DEV  调用 tech-lead-claude
```

这条轨迹是事后审计的唯一可信源。

---

## fast 模式：三角色矩阵（0.3.0+）

fast 模式合并 5 个角色为 3 个，交付速度提升约 50%，代价是放弃部分隔离纪律。仅在单接口/单模块小改动场景使用。

| 维度 | Fullstack | Reviewer | Verifier |
|------|-----------|----------|----------|
| **工具** | Claude | Codex CLI | Codex CLI |
| **Session** | 独立 | 每次新调用 | 每次新调用 |
| **入口 command** | `/cc-nexs:fullstack` | `/cc-nexs:review` | `/cc-nexs:verify` |
| **agent 文件** | `agents/fullstack-claude.md` | `agents/reviewer-codex.md` | `agents/verifier-codex.md` |
| **合并自** | Planner + Tech Lead | SA 代码评审 + Evaluator 契约打分 | QA cases + run + regression |
| **职责** | spec.md + 代码 + 部署文档 + bug 修复 | 评审 spec / 评代码 + 契约验收（合并） | 写测试用例 + 立即跑 + 回归 |
| **可读** | requirements / spec / sa-review / sa-code-review / src/ / bugs/ | spec / test-report / bugs(VERIFIED) / 当次 diff | spec / api-doc / deploy / bugs/ |
| **可写** | spec / src/ / dev-plan / api-doc / deploy / bugs/<id> | sa-review / sa-code-review / acceptance | test-cases / test-report / bugs/ / qa-scripts/ |
| **禁读** | （无强制）| **src/** / dev-plan.md / sa-test-review.md | **src/** / sa-review.md / sa-code-review.md / sa-test-review.md / dev-plan.md |
| **禁写** | progress / acceptance / sa-*.md / test-report | spec / src/ / 其他角色的 md | src/ / sa-*.md / spec.md / acceptance.md |

### 三条最低纪律（fast 仍保留）

1. **先 spec 后代码**：Fullstack 同 session，但必须把 spec.md 五章节写完才能开 src/。中途回头改 AC 必须在"变更记录"留痕。
2. **执行人 ≠ 验收人**：Verifier 跑测试 vs Reviewer 验收 → 两次独立 codex 调用，互不读对方产物。
3. **黑盒大于一切**：Verifier 不读 src/、不读 sa-*.md，签名走 api-doc.md；Reviewer 评代码基于 diff，不浏览源码目录。

### 与 full 的关键放弃

| full 防线 | fast 状态 |
|---|---|
| Planner 不写代码 / Tech Lead 不改 spec | ❌ 合并到 Fullstack（接受同 session 风险）|
| SA 评审用例（sa-test-review.md） | ❌ 跳过（fast 不评测试用例本身）|
| Evaluator 与 SA 严格隔离 | ❌ 合并到 Reviewer（单次 codex 同时产 sa-code-review.md + acceptance.md）|
| Sprint 切片防大改动 | ❌ 强制单 sprint M1 |
| 熔断 3 次重审 | ⚠️ 收紧到 2 次（更早抬升决策层）|

## hooks 适配

`hooks/role-boundary-guard.mjs` 同时识别 full + fast 角色名（`fullstack` / `reviewer` / `verifier`）。orchestrator 在调起子代理时设置环境变量：

```bash
CC_NEXS_ROLE=fullstack    # fast Fullstack
CC_NEXS_ROLE=reviewer     # fast Reviewer
CC_NEXS_ROLE=verifier     # fast Verifier
```
