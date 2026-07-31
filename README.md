# cc-nexs

> 多角色 + 状态机驱动的 Claude Code / Codex / Pi 开发流程框架。源码用 monorepo 维护，发布产物按各运行时的原生扩展机制分发。

## 这是什么

把开发流程 SOP 拆成两层：

- **`packages/core/`** —— 通用框架。状态机引擎、角色注册、reviewer 工具适配、跨平台 hooks、i18n、共享 commands。
- **`packages/preset-*/`** —— 项目预设。声明启用哪些角色、用什么工具、做什么栈检查、加载什么模板。

源码维护方便（monorepo），分发产物扁平（每个 preset 物化进 `dist/`，自包含可装），通过 `pnpm build` 把 core 内容物化进每个 preset 的 dist 目录。Claude Code 与 Codex 使用 dist plugin；Pi 使用根 package manifest、扩展、skills 和 package agents，但三边共用同一份 command SOP。

## 当前预设

| Preset | 适用场景 | 角色 | 工具 | 语言 |
|--------|---------|------|------|------|
| `preset-standard` | 通用多仓项目；具体技术栈由私有 overlay 注入 | 支持 **lean（默认）/ hotfix / fast / full**；Pi 使用 pi-subagents 隔离角色 | 每个 Lean/Hotfix 角色可配置模型与 effort/thinking；公开 preset 不固定模型 ID | 中文 |
| `preset-minimal` | 通用 / 个人项目 / 跨语言起步 | 3 角色（Planner / Developer / Reviewer）| Claude 单工具 + 子代理隔离 | 英文 |

新增预设按 [docs/extending-presets.md](./docs/extending-presets.md) 操作。模式和角色选择见 `preset-standard` 的 [docs/role-map.md](./packages/preset-standard/docs/role-map.md)。

`preset-standard` 新需求默认 Lean：计划批准后按 worktree/feature branch 并行实现，本地 build/start/smoke 通过后做一次集中 Review，再合入 test 验收；第二个人工门禁批准精确 candidate 后才合入配置的 base 分支。Fast/Full 需显式指定；没有 `delivery` 字段的历史需求继续保持旧的逐 Sprint + manual 语义。

Lean 模型按 `preset < cc-nexs.config.yml < feature config.json` 合并。公开 preset 只有 `inherit` profile；私有配置可让 Review 使用不同模型，或沿用实现模型但提高推理等级：

```yaml
models:
  profiles:
    implementation:
      claude:
        model: inherit
        effort: medium
      codex:
        model: inherit
        effort: medium
      pi:
        model: inherit
        effort: medium
    review:
      claude:
        model: inherit
        effort: high
      codex:
        model: inherit
        effort: high
      pi:
        model: inherit
        effort: high
        fallback_models: []
  roles:
    lean-developer: implementation
    lean-reviewer: review
```

将任一 `model: inherit` 换成该运行时已认证的私有模型 ID 即可做异构 Review；三端始终使用独立 Reviewer session。

Claude Code 的 Lean 四角色全部使用独立 Claude 子代理；Codex 的 Lean 四角色全部使用独立 native agent；Pi 由父代理把 profile 的 `model`/`thinking` 直接传给 pi-subagents `Agent`，无需在 `.pi/settings.json` 再维护一份角色映射。Pi 的 `fallback_models` 按顺序重试。

## 目录结构

```
cc-nexs/
├── packages/                       源码（monorepo）
│   ├── core/                       通用框架
│   │   ├── commands/               共享 orchestrator commands（run/approve-spec/status/init）
│   │   ├── lib/                    Node.js 框架代码
│   │   ├── hooks/                  跨平台 .mjs hooks
│   │   ├── schemas/                preset / workspace / overlay / progress.json v2 Schema
│   │   └── i18n/{zh-CN,en-US}.json
│   │
│   ├── preset-standard/            五方异构预设（中文）
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── preset.yml
│   │   ├── agents/ × 5             五方角色身份
│   │   ├── commands/ × 6           preset 自有阶段命令（planner/sa/dev/qa/evaluator/hotfix）
│   │   ├── skills/ × 4
│   │   ├── docs/                   预设架构 / workflow / role-map
│   │   ├── templates/              11 份中文模板
│   │   └── hooks/hooks.json        hook 注册（实现脚本来自 core）
│   │
│   └── preset-minimal/             3 角色通用预设（英文）
│       ├── .claude-plugin/plugin.json
│       ├── .codex-plugin/plugin.json
│       ├── preset.yml
│       ├── agents/ × 3
│       ├── commands/ × 3
│       ├── templates/
│       ├── i18n/en-US/strings.json
│       └── hooks/hooks.json
│
├── scripts/
│   └── build.mjs                   build 脚本：core 物化进每个 preset
│
├── .claude-plugin/                 Claude Code marketplace
│   └── marketplace.json
│
├── .agents/plugins/                Codex marketplace
│   └── marketplace.json
│
├── dist/                           build 产物（**commit 进 git** 让 GitHub / Codex marketplace 能直接装 plugin）
│   ├── preset-standard/            扁平自包含 plugin
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── commands/ × 10          preset 6 + core 4 物化合并
│   │   ├── agents/ × 5
│   │   ├── skills/                 Claude Code 原 skills（不放 Codex mirror，避免污染 Claude 侧）
│   │   ├── codex-skills/           Codex command mirror skills
│   │   ├── docs/
│   │   ├── templates/
│   │   ├── hooks/                  *.mjs（来自 core）+ hooks.json（来自 preset）
│   │   ├── lib/                    core/lib 物化
│   │   ├── schemas/                core/schemas 物化
│   │   └── i18n/                   core + preset 合并
│   └── preset-minimal/             同上结构
│
├── examples/
│   └── using-preset-standard/      演示项目
│
├── docs/
│   ├── architecture.md             core × preset 关系
│   ├── codex-plugin.md             Codex plugin 安装与复刻说明
│   ├── pi-plugin.md                Pi P2 安装、模型隔离与支持边界
│   └── extending-presets.md        写新预设指南
├── pi/
│   ├── extensions/cc-nexs.ts       Pi slash command + child role guard
│   ├── skills/                      lean + fast + hotfix P2 command mirrors
│   └── agents/                      pi-subagents package roles
│
├── pnpm-workspace.yaml
└── package.json
```

## 构建

```bash
pnpm build             # 构建全部 preset
pnpm build:codex       # 同 build；显式用于 Codex plugin 产物刷新
pnpm build:standard    # 仅构建 preset-standard
pnpm build:minimal     # 仅构建 preset-minimal
pnpm validate:claude   # 校验 Claude Code marketplace / install 脚本入口 / skills 隔离
pnpm validate:codex    # 校验 Codex manifest / marketplace / command mirror skills
pnpm validate:pi       # 校验 Pi package / P2 skills / package agents / 无固定模型
pnpm validate:sop      # 校验 lean / full / fast / hotfix 的关键文档落点和 mirror 契约
pnpm smoke:claude-install # 用临时 HOME 烟测 Claude Code 本地安装形态，不碰真实 ~/.claude
pnpm smoke:pi-install  # 用临时 PI_CODING_AGENT_DIR 验证本地 Pi package 注册
pnpm validate:plugins  # 同时校验 Claude Code + Codex 两边 plugin 产物与安装形态
pnpm clean             # 删 dist
```

build 做什么：

1. preset 自有 `commands / agents / skills / docs / templates / preset.yml / i18n` 拷进 `dist/<preset>/`
2. `core/commands` `core/hooks` 物化进 `dist/<preset>/`，**preset 同名文件优先**（不被覆盖）
3. `core/lib` `core/schemas` `core/i18n` 拷进 `dist/<preset>/`
4. 文本类文件做路径 rewrite：`core/lib/X` → `lib/X`、`_core/X` → `X`、`../core/X` → `X`
5. `.claude-plugin/marketplace.json` 自动生成，列出所有 preset 作为 Claude Code plugin
6. `.agents/plugins/marketplace.json` 自动生成，列出所有 preset 作为 Codex plugin
7. 为 Codex 生成 `codex-skills/`：每个 `commands/*.md` 都会生成一个 `$cc-nexs-*` mirror skill，仍回指原 command 文档；原 `skills/` 不写入 Codex mirror，避免影响 Claude Code plugin
8. 为 Pi 生成 lean + fast + hotfix command skills 和 package-qualified role agents；模型由项目/feature profile 解析后直接传给 pi-subagents Agent

dist 是真正的 plugin 载体。Claude Code 读取 `.claude-plugin/marketplace.json`；Codex 读取 `.agents/plugins/marketplace.json`。两者都指向同一批 `dist/preset-*`。

## 安装

### Codex 本地安装

```bash
cd /path/to/cc-nexs
pnpm install:local:codex
```

这会执行：

1. `pnpm build`
2. `pnpm validate:plugins`
3. 把 `dist/preset-*` 同步到 `~/.codex/plugins/cache/cc-nexs/`
4. `codex plugin marketplace add /path/to/cc-nexs`
5. 在 `~/.codex/config.toml` 中默认启用 `cc-nexs@cc-nexs`，关闭 `cc-nexs-minimal@cc-nexs`，避免重复 skill 候选

然后重启 Codex 或开新 thread。可以在 `/plugins` 中检查 `cc-nexs@cc-nexs` 是否已启用；hooks 第一次运行前需要在 `/hooks` 中 review + trust。

Codex 使用显式 skill 入口；`/cc-nexs:*` 仅作为兼容文本提示，不是可执行 shell/slash command：

```text
$cc-nexs-init "需求描述"             # 默认 lean
$cc-nexs-plan 01
$cc-nexs-approve-plan 01
$cc-nexs-init "复杂需求" --mode=full # 只有显式指定才走 full
$cc-nexs-run 01
$cc-nexs-approve-release 01
$cc-nexs-release-base 01
$cc-nexs-release-test 01
$cc-nexs-approve-deploy 01
$cc-nexs-init "现象描述" --mode=hotfix
$cc-nexs-hotfix 02                 # Hotfix 使用自己的新编号，不附着旧需求
```

Codex 侧实现方式是 command mirror skills。`$cc-nexs-run` 读取 `commands/run.md` 作为唯一事实来源，所以 lean / full / fast / hotfix 的文档写入位置和状态机逻辑不会分叉。审批 skill 会调用确定性的 `cc-nexs` 控制程序，不会手工修改 progress。详见 [docs/codex-plugin.md](./docs/codex-plugin.md)。

### Claude Code 本地开发（一条命令）

```bash
cd /path/to/cc-nexs
pnpm install:local              # 等价于：build + 拷到 ~/.claude/plugins/cache/

# 切换到 minimal preset
pnpm install:local:minimal
```

`install:local` 做的事：

1. 跑 `build` 产出 `dist/preset-<name>/`
2. **真实拷贝**到 `~/.claude/plugins/cache/cc-nexs/cc-nexs/<version>/`（不软链——Claude Code 启动期会清理非标准 cache）
3. 同步 `~/.claude/plugins/installed_plugins.json` 元数据
4. 校验 `~/.claude/settings.json` 已启用 plugin

完成后重启 Claude Code 即可生效。后续改源码再跑一次 `pnpm install:local` 即可。

### Pi P2 安装

Pi 当前为实验性 P2 支持，承诺 `preset-standard` lean、fast 和 hotfix 流程。公开 GitHub 安装：

```bash
pi install npm:pi-subagents@0.35.1
pi install git:github.com/injaneity/pi-computer-use@v0.4.3
pi install git:github.com/<github-owner>/cc-nexs
```

从本仓库开发或调试时使用本地安装：

```bash
pnpm install
pnpm install:local:pi
```

Pi 不调用 Codex CLI。Lean 各角色从 cc-nexs profile 解析 `model`、`thinking` 和 `fallback_models`，由父代理直接传入 pi-subagents `Agent`；Reviewer 可用不同模型，也可用相同模型但更高 thinking，主模型不可用时按 fallback 顺序重试。`.pi/settings.json` 只保留 Pi 认证与 `enabledModels` 范围。`@injaneity/pi-computer-use@0.4.3` 提供自动浏览器验收；缺失时基础插件仍可用，但 test release 回退人工。详见 [Pi P2 支持](./docs/pi-plugin.md)。

Claude Code 自动环境验收要求 `chrome-devtools-mcp` 已配置并可调用。Codex 复用当前已登录的 in-app/Chrome 会话。三端都只访问 `release.test.allowed_hosts`；不得从项目 memory、Markdown 或 Git 读取明文账号密码，必要登录只允许通过 opaque `credential_ref` 对接外部 secret provider。

### Claude Code 从 GitHub 装（其他机器 / 协作者）

```bash
/plugin marketplace add <github-owner>/cc-nexs
/plugin install cc-nexs@cc-nexs                 # 五方异构（preset-standard）
/plugin install cc-nexs-minimal@cc-nexs         # 3 角色（preset-minimal）
```

`/plugin marketplace add <github-owner>/cc-nexs` 会拉仓库根目录的 `.claude-plugin/marketplace.json`；它的 `plugins[].source` 指向 `./dist/preset-*`——所以发布仓库必须包含经过可重复构建校验的 `dist/`。

## 日常命令

Claude Code、Codex 和 Pi 共享同一命令语义，但使用各运行时的原生入口。三边都以 `commands/*.md` 为流程事实来源，审批状态统一由 `cc-nexs` 核心命令写入。

| 运行时 | 推荐入口 |
| --- | --- |
| Claude Code | `/cc-nexs:plan 01`、`/cc-nexs:run 01`、`/cc-nexs:approve-release 01` |
| Codex Desktop / CLI | `$cc-nexs-plan 01`、`$cc-nexs-run 01`、`$cc-nexs-approve-release 01` |
| Pi | `/cc-nexs:plan 01`、`/cc-nexs:run 01`、`/cc-nexs:approve-release 01` |
| 普通终端 | `cc-nexs approve-plan 01`、`cc-nexs verify-local 01`、`cc-nexs approve-release 01` |

```bash
/cc-nexs:init "需求描述"          # 默认 lean；每仓独立 worktree + feature/<id>-<slug>
/cc-nexs:plan [编号]               # 生成 requirements/plan 与临时 HTML，停 Gateway A
/cc-nexs:approve-plan [编号]       # 批准 plan 哈希
/cc-nexs:run [编号]                # 实现 → 本地验证 → 一次集中 Review → test 验收
/cc-nexs:approve-release [编号]    # Gateway B，批准精确 tested fingerprint
/cc-nexs:request-release-changes [编号] --type=... --feedback="..."  # Gateway B 提意见并安全回流
/cc-nexs:release-base [编号]       # 批准后合并配置 base，docs 最后归档
/cc-nexs:run [编号] --no-auto-test-release # 本次显式改走人工 test 发布
/cc-nexs:release-test [编号]      # 完整 candidate 确定性合入 test + 调 release driver
/cc-nexs:approve-spec [编号]      # 人工放行 spec
/cc-nexs:status [编号]            # 只读看状态
/cc-nexs:build [--phase=...]      # 按 git diff 自动选 build/test 命令并跑

/cc-nexs:init "现象描述" --mode=hotfix --repos=api  # 独立 latest-base worktree/feature 分支
/cc-nexs:hotfix [新编号]           # mini-Lean：P0/P1/P2/P3、本地验证、一次 Review、test、Gateway B
```

G1/G2 是状态机暂停点，不是全局工具锁。等待人工确认时，父会话仍可执行用户授权的 Git、SQL、SSH、部署、诊断和文档操作；只有 cc-nexs 的下一角色不会被派发。

### 多模块项目按目录自动选 build 命令（v0.3 起）

混合栈仓库（如 backend Java + 前端 Next.js）经常一个仓库多套构建命令。`/cc-nexs:build` 会读 `cc-nexs.config.yml` 的 `paths_override.modules`，用 `git diff` 决定本次需求改了哪些 module，**只跑命中的 module 的命令**：

```yaml
paths_override:
  diff_base: main
  build_cmd: ""      # 顶层 fallback（doc-only 改动时跑）
  test_cmd:  ""

  modules:
    - name: backend
      match: ["api-service/**"]
      build_cmd: "cd api-service && mvn -q compile"
      test_cmd:  "cd api-service && mvn -q test"
    - name: web
      match: ["web/**"]
      build_cmd: "cd web && pnpm build"
      test_cmd:  "cd web && pnpm test"
```

从任一需求 worktree 运行时会向上发现 workspace 根配置，也可显式传 `--config-root`。跨模块改动（同时改了 backend + web）默认最多并行 2 个独立模块；用 `depends_on` 声明顺序约束，命中下游模块时会自动补齐依赖闭包。成功结果绑定完整 Git candidate fingerprint 并缓存在仓库外，HEAD/base/diff/untracked/命令任一变化都会重新执行。`workflow.local_verify.reuse_passed=true` 还会复用同一 candidate 已通过的最终本地 driver 证据。

### 多仓 Worktree 与 Git Custodian（v0.4）

在 workspace 根目录配置 `.cc-nexs/workspace.yml`。`/cc-nexs:init` 首先向 docs 仓远端 base fast-forward push 一个只含 README 和 reservation marker 的最小占号提交，让未使用 cc-nexs 的开发者也能立即看到编号；并发冲突会重新 fetch、换号重试。占号成功后再以各仓最新 `origin/<base_branch>` 创建 `.worktrees/<id>-<slug>/<repo-id>/`；不会使用主 checkout 当前所在的 `test`/`master`，也不会把 feature 的 upstream 错绑到 base 分支。

```
/cc-nexs:init "需求 A"     → 建 .worktrees/01-feat-a/{docs,api,web}/
/cc-nexs:run 01            → 从 workspace 根或任一已分配 worktree 推进

# 同时另开一个需求
cd <workspace-root>
/cc-nexs:init "需求 B"     → 建另一组多仓 worktree
```

角色只写职责内文件，不执行 Git mutation。唯一的直接 docs-base 写入是 Custodian 的第一阶段占号，且只能新建一个此前不存在的需求目录。普通提交不执行 `git pull`。用户明确授权合并到 master 后，由 Custodian fetch 并把最新 base 合入 feature，代码仓先合并、all-docs 第二阶段归档最后合并；同一发布任务随后完整删除远端 feature、本地 feature、worktree 和 candidate ref。只有用户明确要求保留远端分支时才例外。

具体阶段命令（角色单步调用）由各 preset 决定，详见各 preset 的 README。

## 设计原则

1. **事件状态机** —— `progress.json` v2 是带 revision 的权威事件记录，`progress.md` 仅作人类可读视图
2. **两类门禁语义明确** —— Lean 固定 Gateway A（计划）与 Gateway B（tested candidate）；legacy G1 固定，G2 仅在显式退出、能力不足或旧流程中 fallback
3. **三档熔断** —— review 反复打回、修复反复失败、验收反复未过分别升级到不同状态
4. **角色边界硬隔离** —— hooks 通过 `CC_NEXS_ROLE` 环境变量拦截越权操作
5. **预设可插拔** —— 新项目栈写新 preset，不动 core
6. **多运行时同源** —— Claude Code、Codex、Pi 共享 command SOP；运行时只适配角色调度、模型解析和权限拦截
7. **源码 / 分发分离** —— 源码用 monorepo 维护清晰，分发用扁平 plugin 兼容 Claude Code 与 Codex 加载机制

## 状态

当前版本将开发 Sprint 与需求交付分离：所有 Sprint 完成后一次 test release 和最终验收，支持自动前置检查、确定性 test 集成、跨端浏览器验证与失败后的重新发布回归。

## License

MIT
