# 写一个新 preset

按本文步骤可以为新栈 / 新团队 / 新工作流定制 preset。

## 决定要不要新写 preset

| 你的需求 | 推荐 |
|---------|------|
| 改改栈检查规则、build 命令、保留五方异构 | 复制 `preset-standard` 改 |
| 不要五方异构，3 角色够用 | 复制 `preset-minimal` 改 |
| 引入新角色（比如 SecurityAuditor）| 在已有 preset 上加 |
| 切换工具（用 Gemini 而非 Codex）| 改 preset.yml 的 `roles.definitions.<role>.tool` 即可 |
| 全新流程（无 spec、无 sprint）| 重新设计 preset.yml + 自定义 commands |

## 起步

```bash
cd packages/
cp -r preset-minimal preset-myteam
cd preset-myteam
```

修改：

1. **`package.json`** —— 改 name 为 `@cc-nexs/preset-myteam`
2. **`preset.yml`** —— 见下方 schema
3. **`agents/*.md`** —— 改身份 prompt，注入栈特性
4. **`templates/*.md`** —— 改模板，符合你的文档习惯
5. **`i18n/<locale>/strings.json`** —— 本地化用户可见文本
6. **`commands/*.md`** —— 修改阶段命令使其引用本 preset 的 agents

## preset.yml 字段速查

```yaml
name: preset-myteam            # kebab-case
version: 0.1.0
description: 一句话说明
language: zh-CN | en-US        # 默认语言

roles:
  enabled:                     # 顺序敏感，决定状态机分派
    - planner
    - developer
    - reviewer

  definitions:
    planner:
      agent: agents/planner.md  # 相对 preset 根目录
      tool: claude-subagent     # claude-subagent | codex | gemini | openai-cli | custom
      alias: PM                 # 可选：UI 显示名
      session_isolation: independent  # 强制独立 session

    developer:
      agent: agents/dev.md
      tool: claude-subagent
      alias: 工程师

    # 自定义角色
    security-auditor:
      agent: agents/security-auditor.md
      tool: codex
      alias: 安全审计

stack:
  type: java-maven | node-pnpm | python-poetry | rust-cargo | go-mod | generic
  build_cmd: "mvn compile -q"
  test_cmd: "mvn test"
  lint_cmd: "checkstyle ..."
  src_paths:                    # glob 模式，hooks 用它判越权
    - "src/main/**"
    - "src/test/**"
  forbidden_patterns:           # 代码层面的禁令
    - regex: "[一-龥]"
      excludes: ["//", "/\\*", "log\\."]
      description: "代码内禁中文字符串"
    - regex: "\\bTODO\\b"
      excludes: []
      description: "禁 TODO 提交"
  custom_review_rules:          # 字符串，注入 reviewer prompt
    - "禁止使用 @Autowired"
    - "Service 不写 Interface + Impl"

paths:
  doc_dir: "doc/{id}.{slug}/"
  branch_pattern: "feature/{id}-{slug}"
  bugs_dir: "bugs/"

workflow:
  sprint_enabled: true | false
  human_gate_after: spec_reviewing_pass  # 或 null 关闭人工 gate
  thresholds:
    review_revision: 3
    fix_per_bug: 3
    evaluator_reject: 2

i18n:
  conclusion_pass: "PASS"
  conclusion_fail: "NEEDS_REVISION"
  acceptance_pass: "通过"
  acceptance_fail: "未通过"
  test_pass: "通过"
  test_fail: "阻塞"
```

## plugin.json 元数据

preset 源码使用 `.claude-plugin/plugin.json`，不是旧的 `manifest.json`。这里只维护名称、描述、许可证等元数据；不要列举 core commands/agents，也不要写 `../core/...` 路径。`pnpm build` 会把 core 与 preset 内容物化到自包含的 `dist/preset-myteam/`，同时同步根 marketplace。

```json
{
  "name": "cc-nexs-myteam",
  "version": "0.1.0",
  "description": "cc-nexs preset for my team",
  "license": "MIT",
  "keywords": ["claude-code", "plugin", "workflow"]
}
```

如果要支持 Codex，同时维护 `.codex-plugin/plugin.json` 的 Codex UI 元数据，并固定 `"skills": "./codex-skills/"`；这些 skills 由 build 从同一批 authoritative commands 生成，不要手写副本。执行 build/三端验证前必须把 `preset-myteam` 加到根 `release-presets.json`，因为 build 只接受明确列出的发布 preset。

## 角色 agent 文件骨架

```markdown
---
name: <role-name>
description: <一句话>
tools: Read, Write, Edit, Glob, Grep, Bash
allowed_read:
  - spec.md
  - <其他允许读的相对 doc 目录的路径>
allowed_write:
  - spec.md
forbidden_read:
  - src/**
forbidden_write:
  - progress.md
---

你是 <role-alias>。<role-name> 在本项目的职责是 <...>。

## 身份纪律
1. ...
2. ...

## 输入
- doc/<id>/...

## 产出
- doc/<id>/...

## 完成后
仅写入产出文件，不输出额外摘要。orchestrator 会自动推进。
```

`allowed_read / allowed_write / forbidden_read / forbidden_write` 字段被 `core/lib/role-registry.mjs::allowedFiles()` 解析，hooks 据此拦截越权。

## 自定义 hook

如果 core 的 3 个 hook 不够，preset 可以加自己的：

```json
{
  "hooks": {
    "PreToolUse": [
      ...core hooks...,
      {
        "matcher": "Bash",
        "command": "node -e \"const p=require('node:path'),u=require('node:url'),r=process.env.PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT||process.env.CC_NEXS_PLUGIN_ROOT;if(!r)process.exit(1);import(u.pathToFileURL(p.join(r,'hooks','my-custom-check.mjs')).href)\""
      }
    ]
  }
}
```

写在 `packages/preset-myteam/hooks/`，遵循 stdin JSON / exit 0|2 协议。不要在
hook 命令中使用 `${VAR:-fallback}`：它是 POSIX shell 语法，在 Windows
PowerShell 和 `cmd.exe` 中不可移植。应在 Node 启动器中通过 `process.env`
解析插件根目录。

## 验证

```bash
# 1. preset.yml schema 校验
node packages/core/lib/validate-json.mjs \
  packages/core/schemas/preset.schema.json \
  packages/preset-myteam/preset.yml

# 2. plugin metadata + 全量生成物
node -e "JSON.parse(require('fs').readFileSync('packages/preset-myteam/.claude-plugin/plugin.json'))"
pnpm build
node scripts/validate-claude-plugins.mjs
node scripts/validate-codex-plugins.mjs
node scripts/validate-pi-package.mjs

# 3. hook 语法检查
node --check packages/preset-myteam/hooks/*.mjs 2>/dev/null || echo "no custom hooks"

# 4. 装载测试：只装 build 后的自包含 dist，不直接 symlink packages 源码
pnpm install:local
# 在测试项目中跑 /cc-nexs:status 验证 plugin 被识别
```

## 把新 preset 放回 monorepo

如果你的新 preset 适合开源回贡：

1. 在 `pnpm-workspace.yaml` 已有的 `packages/*` glob 自动包含
2. 在根 `release-presets.json` 加入 `preset-myteam`
3. 在根 `README.md` 的 preset 表格加一行
4. 提 PR 到 cc-nexs 主仓
