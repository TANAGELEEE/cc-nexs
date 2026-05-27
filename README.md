# cc-nexs

> 多角色 + 状态机驱动的 Claude Code Plugin 框架。源码用 monorepo 维护，发布产物是扁平自包含 plugin。

## 这是什么

把开发流程 SOP 拆成两层：

- **`packages/core/`** —— 通用框架。状态机引擎、角色注册、reviewer 工具适配、跨平台 hooks、i18n、共享 commands。
- **`packages/preset-*/`** —— 项目预设。声明启用哪些角色、用什么工具、做什么栈检查、加载什么模板。

源码维护方便（monorepo），分发产物扁平（每个 preset 物化进 `dist/`，自包含可装），通过 `pnpm build` 把 core 内容物化进每个 preset 的 dist 目录。

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
│   │   ├── preset.yml
│   │   ├── agents/ × 5             五方角色身份
│   │   ├── commands/ × 6           preset 自有阶段命令（planner/sa/dev/qa/evaluator/hotfix）
│   │   ├── skills/ × 4
│   │   ├── templates/              11 份中文模板
│   │   └── hooks/hooks.json        hook 注册（实现脚本来自 core）
│   │
│   └── preset-minimal/             3 角色通用预设（英文）
│       ├── .claude-plugin/plugin.json
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
├── dist/                           build 产物（**commit 进 git** 让 GitHub 能直接装 plugin）
│   ├── .claude-plugin/marketplace.json
│   ├── preset-nexs/            扁平自包含 plugin
│   │   ├── .claude-plugin/plugin.json
│   │   ├── commands/ × 10          preset 6 + core 4 物化合并
│   │   ├── agents/ × 5
│   │   ├── skills/ × 4
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
│   └── extending-presets.md        写新预设指南
│
├── pnpm-workspace.yaml
└── package.json
```

## 构建

```bash
pnpm build             # 构建全部 preset
pnpm build:nexs    # 仅构建 preset-nexs
pnpm build:minimal     # 仅构建 preset-minimal
pnpm clean             # 删 dist
```

build 做什么：

1. preset 自有 `commands / agents / skills / templates / preset.yml / i18n` 拷进 `dist/<preset>/`
2. `core/commands` `core/hooks` 物化进 `dist/<preset>/`，**preset 同名文件优先**（不被覆盖）
3. `core/lib` `core/schemas` `core/i18n` 拷进 `dist/<preset>/`
4. 文本类文件做路径 rewrite：`core/lib/X` → `lib/X`、`_core/X` → `X`、`../core/X` → `X`
5. `dist/.claude-plugin/marketplace.json` 自动生成，列出所有 preset 作为 plugin

dist 是真正的 Claude Code Plugin marketplace，发布时只发 `dist/`。

## 安装

### 方式 1：本地开发（一条命令）

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

### 方式 2：从 GitHub 装（其他机器 / 协作者）

```bash
/plugin marketplace add TANAGELEEE/cc-nexs
/plugin install cc-nexs@cc-nexs                 # 五方异构（preset-nexs）
/plugin install cc-nexs-minimal@cc-nexs         # 3 角色（preset-minimal）
```

`/plugin marketplace add TANAGELEEE/cc-nexs` 会拉本仓库根目录的 `.claude-plugin/marketplace.json`；它的 `plugins[].source` 指向 `./dist/preset-*`——所以**仓库必须包含 commit 进去的 dist/ 目录**（每次本地改源码后跑一次 `npm run build` 把 dist/ 刷新，再 commit + push 即可）。

## 日常命令

```bash
/cc-nexs:init "需求描述"          # 一句话起新需求，自动续号 + slug + 默认建独立 worktree
/cc-nexs:run [编号]               # 自动状态机，跑到唯一人工 gate 停下（必须在对应 worktree 内运行）
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
2. **唯一人工 checkpoint** —— 默认仅在 spec 通过评审后停一次（preset 可关闭）
3. **三档熔断** —— review 反复打回、修复反复失败、验收反复未过分别升级到不同状态
4. **角色边界硬隔离** —— hooks 通过 `CC_NEXS_ROLE` 环境变量拦截越权操作
5. **预设可插拔** —— 新项目栈写新 preset，不动 core
6. **源码 / 分发分离** —— 源码用 monorepo 维护清晰，分发用扁平 plugin 兼容 Claude Code 加载机制

## 状态

`v0.2.0-dev` 开发中。`v0.1.x` 稳定单体版保留在 git tag `v0.1.0`（试用验证完整流程用）。

## License

MIT
