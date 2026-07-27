---
name: using-cc-nexs
description: 引导新功能、跨模块需求、完整开发测试验收或“按 SOP 跑”进入 cc-nexs。支持 full/fast、多 Sprint 开发、完整需求 test 发布、自动浏览器验收、manual fallback 和 hotfix 分流。
---

# 使用 cc-nexs

以 `commands/*.md` 为流程事实来源。Claude Code、Codex 和 Pi 只适配入口/角色工具，不得分叉状态、产物或 Git 语义。

## 选择入口

- 新功能、跨多个 commit、前后端/多仓、需要 spec 到验收闭环：`init -> run`。
- 单模块、单 Sprint、低复杂度：默认 `mode=fast`。
- 跨模块、DB/外部契约/高风险或需要多个 Sprint：显式 `--mode=full`。
- 小于 50 行常规 BUG：`hotfix`；typo 可直接修。
- 探索 spike 或纯文档任务不强制进入主流程。

## 启动

```text
/cc-nexs:init <需求> [--mode=full|fast]
/cc-nexs:brainstorm <id>          # requirements 模糊时可选
/cc-nexs:run <id>
```

Codex 使用 `$cc-nexs-*` mirror skill；不要把 `/cc-nexs:*` 当 shell path。Pi/Claude 使用 slash command。

## 默认交付

新需求默认：

```yaml
workflow:
  sprint_delivery: final_only
  test_release:
    policy: auto_if_ready
```

- Sprint 只做开发、本地验证、测试用例和代码评审，不逐 Sprint 部署/验收。
- 全部 Sprint 完成后统一 integration review、TEST_RELEASE、FINAL_QA 和最终验收。
- 发布后失败必须修复、独立复审、重新发布、部署后回归；本地验证只能把 BUG 写到 FIXED，不能写 VERIFIED。
- `--no-auto-test-release` 或 feature `release.test=manual` 显式改走人工 test handoff。
- driver/test branch/browser/login/host 安全前置不足时，在 push 前自动回退 manual G2。
- 没有 `delivery` 字段的历史需求保持 `per_sprint + manual`。
- 生产 merge/release 始终人工。

## Browser 前置

- Claude Code：`chrome-devtools-mcp` 可调用。
- Codex：复用当前已登录的 in-app/Chrome session。
- Pi：安装 `@injaneity/pi-computer-use@0.4.3`。

只访问 `release.test.allowed_hosts`。URL 可从项目说明发现，但自动执行前必须进入结构化 `release.test` 配置。禁止从 memory、Markdown、Git 或 config 读取明文账号密码；优先复用登录，必要时仅使用 opaque `credential_ref` 对接外部 secret provider。

## 人工点

1. G1 固定：spec review PASS 后由人决定是否批准。
2. G2 fallback：显式退出自动发布、前置不足或 legacy per_sprint 时使用。

Gate 只暂停 cc-nexs 角色派发，不阻断父会话的用户授权工具。

## 运行时命令映射

```text
run                 主编排
approve-spec        G1
release-test        确定性合入 test + release driver
approve-deploy      manual G2 fallback
status              只读状态和 release evidence
doctor --release-test 严格发布前置检查
hotfix              P0/P1/P2/P3 旁路，仍默认 candidate -> test release -> 回归
```

单步角色命令不推进 progress；只有 `run`/确定性 core controls 可以推进或记录事件。

## 启动检查

- workspace/repository worktree 与 branch assignment 正确；
- requirements、config.mode 和 progress mode 一致；
- full 多 Sprint 切片覆盖全部 AC；
- 自动 test 发布项目已配置 test_branch、driver、test URLs 和 allowed_hosts；
- 当前 runtime 的 browser prerequisite 满足，否则接受 manual fallback。
