# 架构

## 分层

```text
packages/core/
  state-machine.mjs     纯状态路由
  progress-v2.mjs       revision + event + delivery attempts
  git-custodian.mjs     唯一 Git mutation 边界
  test-release.mjs      test 集成与 release driver 控制器
  doctor.mjs            workspace/release 前置检查
  commands/*.md         跨 runtime 流程事实来源

packages/preset-standard/
  preset.yml            默认策略、角色和 browser provider
  commands/agents/      角色级执行契约
  templates/docs/       需求产物与人类文档

dist/preset-standard/   Claude/Codex 可安装物化产物
pi/                     Pi extension、skills、package agents
```

Claude Code、Codex 和 Pi 共用 command 文档与 core 控制器。运行时适配只改变角色派发和浏览器 provider，不改变状态、产物或 Git 语义。

## 权威状态

`progress.json` v2 保存：

- `state`、`revision`、`events[]`；
- role counters、Sprint 状态、G1/G2；
- repository worktree/candidate assignments；
- `delivery.strategy`；
- `delivery.test.policy/status/attempts[]`。

`progress.md` 是渲染镜像。角色不能直接编辑二者；Orchestrator 通过带 revision 的 helper 追加事件。

旧 progress 没有 `delivery` 时运行时注入安全默认：

```json
{"strategy":"per_sprint","test":{"policy":"manual","status":"idle","attempts":[]}}
```

新 progress 默认 `final_only + auto_if_ready`。

## 状态架构

Full 开发与交付分为两个区域：

```text
Development zone
  SPRINT_N_KICKOFF -> DEV/CASES -> DOC_SYNC -> SA_CODE -> DEV_DONE
  repeated until ALL_SPRINTS_DEV_DONE

Delivery zone
  INTEGRATION_REVIEW -> TEST_RELEASE -> FINAL_QA -> FINAL_EVAL -> COMPLETE
```

这个边界避免前后端只完成一半时发布 M1。Sprint 仍可独立评审和形成 candidate，但只有完整需求进入 delivery zone。

Fast 是单 Sprint 压缩版，同样在 CODE_REVIEW 后进入 TEST_RELEASE。

## Git Custodian

角色和 Orchestrator 不执行任意 Git mutation。Git Custodian 负责：

- 创建 workspace worktree；
- 按角色声明的精确路径 stage/commit candidate；
- 维护 `refs/cc-nexs/candidates/<feature>/<repo>`；
- test integration；
- 用户显式授权后的 main merge/finalize。

Test integration 不修改 feature worktree：

```text
candidate ref -> source SHA
latest origin/test -> temp detached worktree
merge --no-ff -> non-force push -> fresh fetch -> ancestry proof
```

远端 test 并发推进导致 non-fast-forward 时停止并要求 retry；不会 force push。candidate 已在远端 ancestry 中时返回幂等成功。

## Release driver

项目通过私有配置提供：

```yaml
release:
  test:
    environment: test
    app_url: https://test.example.com
    operations_url: https://ops.example.com
    allowed_hosts: [test.example.com, ops.example.com]
    credential_ref: keychain://cc-nexs/test-console
    driver:
      command: node
      args: [.cc-nexs/release-driver.mjs]
      timeout_seconds: 1800
```

controller 通过 stdin 发送一份 JSON request。driver stdout 必须只写一份 JSON object：

```json
{
  "status": "succeeded",
  "pipeline": {"id": "...", "url": "..."},
  "deployment": {"id": "...", "environment": "test"},
  "environment_revision": {"api": "sha", "web": "sha"}
}
```

其他终态为 `failed` 或 `deployed_needs_manual_verification`。成功但缺 pipeline/deployment/environment_revision 会失败关闭。

## Browser capability

Browser 是 test release 的前置能力和最终 QA 工具：

| Runtime | 能力 |
|---|---|
| Claude Code | `chrome-devtools-mcp` |
| Codex | 当前登录的 in-app/Chrome session |
| Pi | `@injaneity/pi-computer-use@0.4.3` tools |

URL 可以来自 versioned project config 或 private overlay。项目 memory/说明中的 URL 只能用于发现候选，自动流程必须先把 host 纳入 `allowed_hosts`。账号密码不能来自 memory、Markdown、Git 或普通 config；优先复用登录，必要时只传 opaque `credential_ref` 给外部 secret provider。

MFA、CAPTCHA、过期登录、provider 不可用或环境身份不清晰都会在 push 前触发 manual fallback。

## Release attempt

每次 attempt 使用排序后的 `{repository: sourceSHA}` 计算 fingerprint。事件顺序：

```text
delivery.test.started
delivery.test.repository_integrated (per repository)
delivery.test.succeeded | failed | deployed_needs_manual_verification
delivery.test.verification_passed | verification_blocked
```

相同成功 fingerprint 重复调用复用历史 attempt。失败 fingerprint 只有显式 `--retry` 才新建 attempt。修复 candidate SHA 变化自然形成下一轮。

## 失败一致性

- 部分仓已合入：attempt 保留每仓证据，retry 幂等补齐。
- driver 失败/超时/非法 JSON：attempt 标为 failed，进入 release block。
- 已部署但 browser verification 不可完成：单独状态等待人工，不谎报成功。
- QA 失败：本地修复到 FIXED，独立复审，重新发布，部署后回归到 VERIFIED。
- 最终验收失败：回 integration 修订，不直接改状态通过。

## 运行时物化

`scripts/build.mjs`：

- 把 core/preset 物化到 `dist/preset-*`；
- 为 Codex 每个 command 生成 mirror skill；approval/release-test 包含确定性 CLI block；
- 为 Pi 生成受限 P2 command skills 和 package agents；Verifier allowlist 增加 computer-use 工具；
- 保持 Claude commands 为同一份事实来源。

Pi 基础安装只强制 `pi-subagents`。computer-use 缺失产生警告并使自动浏览器验证回退 manual，不阻断 init/status/build 等能力。

## 安全边界

- 自动 controller 只接受 `environment=test` 和非 production-like allowlisted host。
- 禁止 force push、生产 branch 和隐式 main merge。
- 禁止明文 `password/passwd/credentials/secret_value` 配置字段。
- Browser 只允许 configured hosts。
- 角色子会话不能 mutation Git 或 progress。
- G1/G2 是状态机 stop，不是全局工具阻断。

## 完成与生产

`COMPLETE` 只证明 test 环境和契约闭环。生产合并、生产部署、远端分支删除和 worktree cleanup 都属于后续显式人工授权操作。
