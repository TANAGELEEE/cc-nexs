---
name: "using-cc-nexs"
description: "引导新功能、跨模块需求、完整开发测试验收或“按 SOP 跑”进入 cc-nexs。新需求默认 lean，支持一次集中 Review、full/fast、test 发布、自动浏览器验收、manual fallback 和 hotfix 分流。"
disable-model-invocation: true
---

# 使用 cc-nexs

以 `commands/*.md` 为流程事实来源。Claude Code、Codex 和 Pi 只适配入口/角色工具，不得分叉状态、产物或 Git 语义。

## 选择入口

- 常规新功能：默认 `init -> plan -> Gateway A -> run -> Gateway B`，使用 `mode=lean`。
- 需要旧三角色、多轮代码/验收分离：显式 `--mode=fast`。
- 高风险、复杂 DB/外部契约或确需多个 Sprint/多轮专业评审：显式 `--mode=full`。
- 可界定的小范围 BUG：先 `init --mode=hotfix` 创建独立 latest-base feature/worktree，再执行 `hotfix <id>`；契约/schema/权限变化直接走 Lean/Full。
- 探索 spike 或纯文档任务不强制进入主流程。

## 启动

```text
/cc-nexs:init <需求> [--mode=lean|hotfix|fast|full]
/cc-nexs:brainstorm <id>          # requirements 模糊时可选
/cc-nexs:plan <id>                # lean 默认；输出 HTML 后停 Gateway A
/cc-nexs:approve-plan <id>
/cc-nexs:run <id>                 # 实现、本地验证、一次集中 Review、test 验收
```

Codex 使用 `$cc-nexs-*` mirror skill；不要把 `/cc-nexs:*` 当 shell path。Pi/Claude 使用 slash command。

## 默认交付

Lean 新需求默认：

```yaml
workflow:
  sprint_delivery: final_only
  test_release:
    policy: auto_if_ready
```

- 只维护 `requirements.md` 和 `plan.md` 两份人工文档；HTML 是临时渲染物。
- 按 plan 的路径所有权并行实现，先用本地 driver 完成 build/start/smoke/e2e，再做一次独立集中 Review。
- Review 阻塞只允许一次修复后的 delta closure；test 失败也必须重新本地验证、delta closure 和发布。
- test 验收通过后停在 Gateway B；只有 `/cc-nexs:approve-release` 才授权合并配置的 base 分支。
- `--no-auto-test-release` 或 feature `release.test=manual` 显式改走人工 test handoff。
- driver/test branch/browser/login/host 安全前置不足时，在 push 前自动回退 manual G2。
- 没有 `delivery` 字段的历史需求保持 `per_sprint + manual`。
- 生产 merge/release 始终人工。

## Browser 前置

- Claude Code：`chrome-devtools-mcp` 可调用。
- Codex：复用当前已登录的 in-app/Chrome session。
- Pi：优先安装并完成 ego lite 引导以及 `ego-browser` skill；Windows 或 ego lite 不可用时，安装 `@injaneity/pi-computer-use@0.4.3`，并在 `.pi/computer-use.json` 设置 `browser_use: true`、`headless: true`。若两者都不可用则回退 manual G2。

只访问 `release.test.allowed_hosts`。URL 可从项目说明发现，但自动执行前必须进入结构化 `release.test` 配置。禁止从 memory、Markdown、Git 或 config 读取明文账号密码；优先复用登录，必要时仅使用 opaque `credential_ref` 对接外部 secret provider。

## 人工点

1. Lean Gateway A：批准 requirements + plan 的哈希绑定。
2. Lean Gateway B：批准已集中 Review、本地验证和 test 验收的精确 candidate fingerprint。
3. Hotfix Gateway B：test 黑盒验收通过后批准 exact candidate 合入 base。
4. Legacy G1/G2：仅 fast/full 保留原语义。

Gate 只暂停 cc-nexs 角色派发，不阻断父会话的用户授权工具。

## 运行时命令映射

```text
run                 主编排
plan                Lean 计划 + HTML
approve-plan        Lean Gateway A
verify-local        确定性本地集成验证
lean-review         一次集中 Review / 一次 delta closure
approve-release     Lean/Hotfix Gateway B
release-base        批准后确定性合并 base
approve-spec        G1
release-test        确定性合入 test + release driver
approve-deploy      manual G2 fallback
status              只读状态和 release evidence
doctor --release-test 严格发布前置检查
hotfix              独立 P0/P1/P2/P3 mini-Lean：scope binding -> local -> one Review -> test -> Gateway B
```

单步角色命令不推进 progress；只有 `run`/确定性 core controls 可以推进或记录事件。

## 启动检查

- workspace/repository worktree 与 branch assignment 正确；
- requirements、config.mode 和 progress mode 一致；
- lean/hotfix 已配置 `workflow.local_verify.driver`，并保持批准 plan 或绑定 hotfix scope 不变；
- full 多 Sprint 切片覆盖全部 AC；
- 自动 test 发布项目已配置 test_branch、driver、test URLs 和 allowed_hosts；
- 当前 runtime 的 browser prerequisite 满足，否则接受 manual fallback。
