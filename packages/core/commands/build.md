---
description: 按 git diff + cc-nexs.config.yml 的 paths_override.modules 规则，自动选择并执行需要跑的 build / test 命令。跨模块改动会顺序跑命中的所有模块；任一失败 fail fast。
allowed-tools: Read, Bash
argument-hint: [--phase=build|test|both] [--dry-run]
---

# /cc-nexs:build

按本次需求实际改动了哪些文件，自动选 build / test 命令。

## 何时用

- Tech Lead / Fullstack 编码完，验证变更可编译/可测试
- QA / Verifier 跑测试前，确保用对应模块命令
- 任何"改完想跑一下 build"的场景

替代了"硬编码 `mvn compile -q`"——多模块项目里这条命令在 `web/` 改动时本就不该跑。

## 参数

- `--phase=build|test|both`（默认 `both`）：只跑 build、只跑 test、还是先 build 再 test
- `--dry-run`：只打印将要执行的命令，不实际跑

## 执行步骤

### 1. 解析参数

```bash
PHASE="both"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --phase=*) PHASE="${arg#--phase=}" ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done
case "$PHASE" in
  build|test|both) ;;
  *) echo "❌ --phase 必须是 build / test / both"; exit 1 ;;
esac
```

### 2. 调用 selector 拿命令列表

selector 路径取决于安装方式。优先用 plugin 提供的 `${CLAUDE_PLUGIN_ROOT}/lib/build-selector.mjs`：

```bash
SELECTOR="${CLAUDE_PLUGIN_ROOT}/lib/build-selector.mjs"
if [ ! -f "$SELECTOR" ]; then
  # Monorepo dev-mode fallback (running from cc-nexs source repo).
  SELECTOR="$(git rev-parse --show-toplevel)/packages/core/lib/build-selector.mjs"
fi
[ -f "$SELECTOR" ] || { echo "❌ 找不到 build-selector.mjs（CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT}）"; exit 1; }

# JSON 模式拿结构化输出
PROJECT_ROOT=$(git rev-parse --show-toplevel)
SELECTION=$(node "$SELECTOR" --cwd "$PROJECT_ROOT" --json)
```

> 说明：selector 用 `git diff --name-only <diff_base>...HEAD` + `git status --porcelain` 取改动文件（含未提交），按 `paths_override.modules[*].match` 的 glob 匹配。`diff_base` 默认 `main`，可在 yml 里改：`paths_override.diff_base: master`。

### 3. 报告选择结果

把 SELECTION JSON 解析出来给用户看：

```
🔍 Build selection
   diff base:    <diff_base>
   changed:      <N files>
   matched:      <module names | "(none, fallback)">
   reason:       <reason from selector>

Build commands:
  - <cmd 1>
  - <cmd 2>
Test commands:
  - <cmd 1>
```

如果 `fallback=true`：

```
⚠️ 没有 module 命中——使用顶层 build_cmd / test_cmd
   常见原因：
   - cc-nexs.config.yml 没声明 paths_override.modules
   - 本次需求只动了 doc/，没改源码
   - module match glob 写错了（用 /cc-nexs:build --dry-run 看 changed 列表对照检查）
```

如果命令列表空（fallback 也没顶层命令）：直接报错退出，提示用户去配 yml。

### 4. 执行命令（除非 `--dry-run`）

按 `PHASE` 串行跑，**任一失败立刻退出**。

```bash
run_phase() {
  local phase="$1"
  local cmds_json="$2"

  # cmds_json 是 build_cmds 或 test_cmds 的 JSON 数组字符串
  echo "$cmds_json" | node -e '
    const arr = JSON.parse(require("fs").readFileSync(0, "utf-8") || "[]");
    process.stdout.write(arr.join("\n"));
  ' | while IFS= read -r cmd; do
    [ -z "$cmd" ] && continue
    echo ""
    echo "▶ [$phase] $cmd"
    if [ "$DRY_RUN" = "1" ]; then
      echo "  (dry-run; not executed)"
      continue
    fi
    # 用 bash -c 让命令里的 cd / && 等 shell 语法生效
    if ! bash -c "$cmd"; then
      echo "❌ [$phase] failed: $cmd"
      exit 1
    fi
  done
}

BUILD_CMDS=$(echo "$SELECTION" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf-8")).build_cmds))')
TEST_CMDS=$(echo "$SELECTION"  | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf-8")).test_cmds))')

case "$PHASE" in
  build) run_phase build "$BUILD_CMDS" ;;
  test)  run_phase test  "$TEST_CMDS" ;;
  both)  run_phase build "$BUILD_CMDS" && run_phase test "$TEST_CMDS" ;;
esac
```

### 5. 总结

```
✅ build phase passed: <N> commands
✅ test phase passed:  <N> commands
   matched modules:    <names>
```

或失败：

```
❌ <phase> failed at: <cmd>
   matched modules:   <names>
   tip: 单独再跑一次定位：bash -c "<cmd>"
```

## 配置示例（写在 `cc-nexs.config.yml`）

```yaml
preset: preset-nexs
paths_override:
  diff_base: main          # 可选，默认 main
  build_cmd: ""            # 顶层 fallback；module 都不命中时用
  test_cmd:  ""

  modules:
    - name: backend
      match:
        - "backend-java/**"
      build_cmd: "cd backend-java && mvn -q -DskipTests compile"
      test_cmd:  "cd backend-java && mvn -q test"

    - name: web
      match:
        - "web/**"
      build_cmd: "cd web && pnpm build"
      test_cmd:  "cd web && pnpm test"

    - name: ops-admin
      match:
        - "sa-ops-admin/**"
      build_cmd: "cd sa-ops-admin && pnpm build"
      test_cmd:  "cd sa-ops-admin && pnpm test"

    - name: e2e
      match:
        - "e2e-smoke/**"
      build_cmd: ""                      # 留空表示该模块不需要 build
      test_cmd:  "cd e2e-smoke && pnpm test:e2e"
```

跨模块需求（同时改了 backend + web）：selector 把 backend 和 web 的命令都列上，按 yml 顺序跑。

## 常见问题

| 问题 | 原因 | 处理 |
|------|------|------|
| `matched=[]` 但确实改了源码 | match glob 不对 | `/cc-nexs:build --dry-run` 看 changed 列表，对照修 glob |
| `git diff` 报 "unknown revision main" | 仓库主分支叫 master | yml 加 `paths_override.diff_base: master` |
| 命令里有 `cd X &&` 报错 | shell 语法 | selector 用 `bash -c` 跑，原生支持 |
| 改了 doc/ 也跑了 build | doc 默认不命中任何 module → fallback 顶层 | 顶层 `build_cmd: ""` 留空就不跑 |
