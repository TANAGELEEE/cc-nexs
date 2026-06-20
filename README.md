# cc-nexs

> 多角色 + 状态机驱动的 Claude Code / Codex Plugin 框架。源码用 monorepo 维护，发布产物是扁平自包含 plugin。

## 这是什么

把开发流程 SOP 拆成两层：

- **`packages/core/`** —— 通用框架。状态机引擎、角色注册、reviewer 工具适配、跨平台 hooks、i18n、共享 commands。
- **`packages/preset-*/`** —— 项目预设。声明启用哪些角色、用什么工具、做什么栈检查、加载什么模板。

源码维护方便（monorepo），分发产物扁平（每个 preset 物化进 `dist/`，自包含可装），通过 `pnpm build` 把 core 内容物化进每个 preset 的 dist 目录。每个 dist preset 同时带 `.claude-plugin/` 和 `.codex-plugin/`，保证 Claude Code 与 Codex 共用同一份 SOP。

## 当前预设

| Preset | 适用场景 | 角色 | 工具 | 语言 |
|--------|---------|------|------|------|
| `preset-nexs` | Java/Maven/Spring 项目 | 5 方异构（Planner / Tech Lead / SA / QA / Evaluator），支持 **full / fast 两种模式**（fast 合并为 3 角色 Fullstack / Reviewer / Verifier，子代理调用量减半） | Claude × 2 + Codex × 3 | 中文 |
| `preset-minimal` | 通用 / 个人项目 / 跨语言起步 | 3 角色（Planner / Developer / Reviewer）| Claude 单工具 + 子代理隔离 | 英文 |

新增预设按 [docs/extending-presets.md](./docs/extending-presets.md) 操作。fast 模式选择见 `preset-nexs` 的 [docs/role-map.md](./packages/preset-nexs/docs/role-map.md)。

## 目录结构

```
cc-nexs/
├── packages/                       源码（monorepo）
│   ├── core/                       通用框架
│   │   ├── commands/               共享 orchestrator commands（run/approve-spec/status/init）
│   │   ├── lib/                    Node.js 框架代码
│   │   ├── hooks/                  跨平台 .mjs hooks
│   │   ├── schemas/                preset.yml / progress.md JSON Schema
│   │   └── i18n/{zh-CN,en-US}.json
│   │
│   ├── preset-nexs/            五方异构预设（中文）
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
│   ├── preset-nexs/            扁平自包含 plugin
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
│   └── using-preset-nexs/      演示项目
│
├── docs/
│   ├── architecture.md             core × preset 关系
│   ├── codex-plugin.md             Codex plugin 安装与复刻说明
│   └── extending-presets.md        写新预设指南
│
├── pnpm-workspace.yaml
└── package.json
```

## 构建

```bash
pnpm build             # 构建全部 preset
pnpm build:codex       # 同 build；显式用于 Codex plugin 产物刷新
pnpm build:nexs    # 仅构建 preset-nexs
pnpm build:minimal     # 仅构建 preset-minimal
pnpm validate:claude   # 校验 Claude Code marketplace / install 脚本入口 / skills 隔离
pnpm validate:codex    # 校验 Codex manifest / marketplace / command mirror skills
pnpm validate:sop      # 校验 full / fast / hotfix 的关键文档落点和 mirror 契约
pnpm smoke:claude-install # 用临时 HOME 烟测 Claude Code 本地安装形态，不碰真实 ~/.claude
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

Codex 中保留同一套命令语义：

```text
/cc-nexs:init "需求描述" --mode=full
/cc-nexs:init "需求描述" --mode=fast
/cc-nexs:run 01
/cc-nexs:approve-spec 01
/cc-nexs:hotfix "现象描述"
```

Codex 侧实现方式是 command mirror skills。比如 `/cc-nexs:run` 会触发 `$cc-nexs-run`，该 skill 读取 `commands/run.md` 作为唯一事实来源，所以 full / fast / hotfix 的文档写入位置和状态机逻辑不会分叉。详见 [docs/codex-plugin.md](./docs/codex-plugin.md)。

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

### Claude Code 从 GitHub 装（其他机器 / 协作者）

```bash
/plugin marketplace add TANAGELEEE/cc-nexs
/plugin install cc-nexs@cc-nexs                 # 五方异构（preset-nexs）
/plugin install cc-nexs-minimal@cc-nexs         # 3 角色（preset-minimal）
```

`/plugin marketplace add TANAGELEEE/cc-nexs` 会拉本仓库根目录的 `.claude-plugin/marketplace.json`；它的 `plugins[].source` 指向 `./dist/preset-*`——所以**仓库必须包含 commit 进去的 dist/ 目录**（每次本地改源码后跑一次 `npm run build` 把 dist/ 刷新，再 commit + push 即可）。

## 日常命令

Claude Code 里是 slash command；Codex 里可以直接输入同样的文本，或显式调用对应 mirror skill（例如 `$cc-nexs-run`）。两边都以 `commands/*.md` 为事实来源。

```bash
/cc-nexs:init "需求描述"          # 一句话起新需求，自动续号 + slug + 默认建独立 worktree
/cc-nexs:run [编号]               # 自动状态机，跑到人工 gate 停下（G1: spec 审批, G2: 部署确认）
/cc-nexs:approve-spec [编号]      # 人工放行 spec
/cc-nexs:status [编号]            # 只读看状态
/cc-nexs:build [--phase=...]      # 按 git diff 自动选 build/test 命令并跑

/cc-nexs:hotfix "现象描述"        # 旁路 bug 修复（按现象自动判档 P0/P1/P2/P3）
```

### 多模块项目按目录自动选 build 命令（v0.3 起）

混合栈仓库（如 backend Java + 前端 Next.js）经常一个仓库多套构建命令。`/cc-nexs:build` 会读 `cc-nexs.config.yml` 的 `paths_override.modules`，用 `git diff` 决定本次需求改了哪些 module，**只跑命中的 module 的命令**：

```yaml
paths_override:
  diff_base: main
  build_cmd: ""      # 顶层 fallback（doc-only 改动时跑）
  test_cmd:  ""

  modules:
    - name: backend
      match: ["backend-java/**"]
      build_cmd: "cd backend-java && mvn -q compile"
      test_cmd:  "cd backend-java && mvn -q test"
    - name: web
      match: ["web/**"]
      build_cmd: "cd web && pnpm build"
      test_cmd:  "cd web && pnpm test"
```

跨模块改动（同时改了 backend + web）：按 yml 顺序串行跑两套命令，任一失败 fail fast。Tech Lead / Fullstack 编码完应直接调 `/cc-nexs:build` 取代固定的 `mvn compile`。

### Worktree 默认开启（v0.3 起）

`/cc-nexs:init` 默认在 `<repo>/.worktrees/<id>-<slug>/` 建独立 git worktree，让多个需求**真正可以并行开发**——同一仓库同时开 A/B/C 三个 feature 互不干扰。流程：

```
/cc-nexs:init "需求 A"     → 建 .worktrees/01-feat-a/ + feature/01-feat-a 分支
cd .worktrees/01-feat-a    → 进 worktree
/cc-nexs:run 01            → 在 worktree 内推进状态机

# 同时另开一个需求
cd <repo-root>             → 回主仓库
/cc-nexs:init "需求 B"     → 建 .worktrees/02-feat-b/ + feature/02-feat-b 分支
```

要恢复旧行为（在当前目录直接 `git checkout -b`），加 `--no-worktree`：

```
/cc-nexs:init "微调首页文案" --no-worktree
```

完成后**不会自动清理** worktree——`/cc-nexs:run` 跑到 `COMPLETE` 时只打印手动清理指令（`git worktree remove .worktrees/<id>-<slug>`）。

具体阶段命令（角色单步调用）由各 preset 决定，详见各 preset 的 README。

## 设计原则

1. **状态机驱动** —— 每个需求目录下 `progress.md` 持久化状态，编排器按状态自动推进
2. **两个人工 checkpoint** —— G1: spec 通过评审后停一次；G2: 代码评审通过后部署确认（preset 可关闭）
3. **三档熔断** —— review 反复打回、修复反复失败、验收反复未过分别升级到不同状态
4. **角色边界硬隔离** —— hooks 通过 `CC_NEXS_ROLE` 环境变量拦截越权操作
5. **预设可插拔** —— 新项目栈写新 preset，不动 core
6. **双运行时同源** —— Claude Code 与 Codex 都读取同一份 commands / agents / templates / lib，避免 SOP 漂移
7. **源码 / 分发分离** —— 源码用 monorepo 维护清晰，分发用扁平 plugin 兼容 Claude Code 与 Codex 加载机制

## 状态

`v0.2.0-dev` 开发中。`v0.1.x` 稳定单体版保留在 git tag `v0.1.0`（试用验证完整流程用）。

## License

MIT
