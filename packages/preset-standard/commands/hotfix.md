---
description: "Hotfix：独立修复分支与 BUG 文档、本地验证、独立 Review、test 验收和 Gateway B。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Grep, Task, Skill"
argument-hint: "<bug-key | bug 现象> [--level=P0|P1|P2|P3] [--related=<feature-id>] [--repos=a,b] [--bug-file=<docs-relative.md>]"
---

# /cc-nexs:hotfix

Hotfix 使用独立的修复分支和 BUG 文档，不占共享需求编号，不发布占位目录。参数为已有 `mode=hotfix` 的 bug-key 或旧编号时恢复原任务；参数为 bug 描述时，先确定受影响仓库和 slug，再运行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs init-hotfix <slug> --description "<bug 现象>" [--bug-key YYYYMMDD-slug] [--related <feature-id>] [--repos a,b] [--bug-file <docs-relative.md>]
```

Git Custodian 从各仓最新 `origin/<base_branch>` 创建 `hotfix/<key>` 和 `.worktrees/<key>/<repo>/`，不复用旧需求分支。命令不调用 `publishDocsReservation()`，不创建或 push README/reservation 占位文件。

- 有 `--related` 时，BUG 文档默认写入关联需求的 `doc/<id>.<slug>/bugs/BUG-<key>.md`；关联不改变旧需求状态。
- 无关联时，BUG 文档默认写入 docs 仓的 `hotfix/<key>/BUG-001.md`。
- `--bug-file` 可指定 docs 仓内的 Markdown 路径；必须通过路径安全校验，不覆盖已有无关文档。
- 权威状态和配置在 workspace 的 `.cc-nexs/hotfixes/<key>/`。通过 `progress.hotfix_document` 定位 docs worktree 中的 BUG 文件，不能把机器状态目录当作文档目录。
- 旧任务继续解析原 `doc/<id>.<slug>/hotfix.md` 和原机器状态，不要求重新初始化。

## 1. 分级与绑定

按影响和紧急性判级；P0 为正在发生的生产事故，P1 为关键流程或核心数据受影响，P2 为影响面可界定的行为缺陷，P3 为无行为变化的文案、样式等修复。单文件、20 行仅作为分级参考，不能证明没有行为变化。P0/P1/P2/P3 全部需要独立 Review。

填写 BUG 文档的 `HOTFIX-SCOPE`：

- `intended_paths` 必须列出实际修复路径，多仓使用 `repo-id/path`，逗号分隔；不能保留 `-`。
- P0/P1 必须填写 `affected_acs`、`rollback_owner`、`rollback_steps`。
- 在范围标记内填写本地验证矩阵，首列为 `Check`，命令列为 `命令/Driver`。记录唯一检查 ID 和将实际执行的完整命令；不能用「跑相关测试」等描述代替命令。
- AC、API、数据库 schema、权限模型或大范围重构变化不能继续按 Hotfix 执行，使用第 4 节的 `--promote-lean`。

然后绑定范围：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs start-hotfix <id> [--level P2] [--related <feature-id>]
```

这里及后续 `<id>` 指 bug-key，也兼容旧 Hotfix 编号。本命令及用户已授权的修复范围构成 Hotfix 授权，不新增 Gateway A。绑定后不得静默改变范围、分级或验证矩阵；确需调整时使用 `revise-hotfix` 记录已有用户授权。

## 2. 实现、本地验证与 Review

```text
INIT -> HOTFIX_IMPLEMENTING -> HOTFIX_IMPLEMENTED -> HOTFIX_LOCAL_VERIFYING
-> HOTFIX_REVIEWING -> PARSE_HOTFIX_REVIEW -> HOTFIX_CANDIDATE_READY
-> HOTFIX_TEST_RELEASE -> HOTFIX_TEST_VERIFYING
-> HOTFIX_TEST_VERIFIED -> HOTFIX_RELEASE_PENDING_HUMAN
-> /approve-release -> HOTFIX_BASE_MERGING -> COMPLETE
```

Orchestrator 按 `progress.json.mode=hotfix` 调用 `nextStep`。Developer、Reviewer、Verifier 分别使用专用角色，Review 和验证必须在独立 session 中执行。实现阶段仅修改绑定路径；Git Custodian 记录精确 candidate 后执行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs verify-local <id>
```

有 `workflow.local_verify.driver` 时使用 driver；无 driver 时在精确 candidate worktree 中执行绑定矩阵内的命令，再用 `verify-local <id> --passed|--failed --evidence-json <json>` 登记真实结果。每项证据包含 `check`、`command`、整数 `exit_code`、`proof` 和 `result`，必须覆盖绑定矩阵且命令一致。Hotfix 不允许 `deferred_to_test`，不得把真实失败写成通过。相同 candidate 和有效范围的已通过证据可以复用。

所有级别本地通过后都进入独立集中 Review：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs record-review <id> --passed|--blocked [--finding "P0/P1 ..."]
```

Review 一次性检查完整候选和调用面，修复后进入 `HOTFIX_DELTA_REVIEW` 并用 `--closure` 检查对应 delta。遵循状态机已有熔断；遇到已获用户授权的范围修订，按第 4 节重绑，不通过手改计数或重开号规避状态。P3 没有免 Review 路径。

每次 dispatch 使用 `resolveRoleRuntime(preset, role, runtime, {models: mergedModels, featureConfig, progress: progressV2})`。默认 Developer=`balanced`、Reviewer=`review`、Verifier=`balanced`；P0/P1 的 Reviewer 自动路由到 `escalated`。允许同一模型但更高 effort/thinking，或使用不同模型；硬约束是 session 隔离。feature `models.roles` 显式覆盖最终优先，公开默认不固定模型 ID。

## 3. Test、Gateway B 与完成

就绪后运行 `release-test <id> --hotfix`：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs release-test <id> --hotfix [--retry|--resume]
```

仅在 `HOTFIX_TEST_RELEASE` 发布精确 candidate 到配置的 test。`pending` 只恢复轮询，不重复触发 CI。独立 Verifier 在本次 `environment_revision` 运行 BUG repro、受影响 AC 和冒烟，将结果追加到 BUG 文档并用 `record-test-verification` 绑定 attempt。失败修复产生新 candidate、新 test attempt 和回归证据，本地通过不能替代 test 验收。

环境、浏览器、登录或 URL 限制只在真实 test 部署后记录为 `manual_required`。默认保留阻塞事实并恢复同一 attempt；用户明确授权环境例外时，才允许在现有 Gateway B 调用 `approve-release --test-exception`，提供授权记录、原因、环境限制证据和回滚证据。例外要求同一 candidate 已通过本地验证及独立 Review，且已有真实 test 部署；产品测试失败、未部署或证据缺失不能使用例外。例外不把 test 标成通过，也不默认授权生产部署。

正常验收后在 `HOTFIX_RELEASE_PENDING_HUMAN` 展示 scope hash、candidate commits、本地证据、Review、test attempt/environment revision、回滚信息和 base targets，等待 `/cc-nexs:approve-release <id>`。已有用户授权可由确定性控制器记录，无需重复增加确认轮。

Gateway B 的 `evidence` 意见只追加文档；`implementation` 意见失效当前证据，修复后重新验证。批准后只把同一 candidate 合入配置的 base。禁止 `test -> base`、force push 或从 test 重新选 candidate。base 仅有不重叠路径的更新时，保持已验收 candidate 不变，由 release-base 集成，不重跑 test 或审批。重叠路径或已知跨文件契约依赖需要处理和验证后再发布；不能把无文本冲突当作语义独立证明。

只有 `HOTFIX_BASE_MERGING -> COMPLETE` 且远端 ancestry 通过才完成。新 Hotfix 最终 docs candidate 只包含本次 BUG 文档，机器状态留在 `.cc-nexs/hotfixes/<key>/`；旧任务保留原归档文件集合。docs 最后合入并安全清理 worktree/分支/ref。生产发布仍需组织规定的明确授权。

## 4. 同一故障修订与升级 Lean

同一故障的路径、分级或验证命令需要调整且用户已经授权时，更新 BUG 范围后运行：

```text
node <plugin-root>/lib/cc-nexs-cli.mjs revise-hotfix <id> --reason "<修订原因>" --authorization-evidence "<已有用户授权记录>"
```

控制器在原 bug-key、原分支和原 worktree 上重绑范围，保留历史，清除当前本地/Review/test 证据和发布批准。不得手改状态或伪造授权，也不因 P3 升为 P2 重新占需求号。

真实契约/schema/权限扩展使用同一命令加 `--promote-lean`。它在原 BUG 旁建立 `<BUGstem>.lean/requirements.md`、`plan.md` 和迁移后的状态，保留分支和 key；原本地状态保存为 `progress.hotfix-history.json`，避免同一个 key 被双重定位。继续 Lean 计划并通过 Gateway A 后才能实施扩展，不新增占号目录。
