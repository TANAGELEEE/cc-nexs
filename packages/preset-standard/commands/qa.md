---
description: "QA 黑盒测试入口。Sprint 阶段写/评用例；完整需求发布到 test 后执行 final 或 final-regression。禁读 src/。"
disable-model-invocation: true
allowed-tools: "Read, Write, Edit, Bash, Glob, Task, mcp__chrome-devtools__*"
argument-hint: "<phase: cases|run|regression|final|final-regression> [需求编号] [--sprint=N] [--revise]"
---

# /cc-nexs:qa

参数：
- `$1` = phase: `cases` / `run` / `regression`（legacy per_sprint）/ `final` / `final-regression`
- `$2` = 需求编号
- `--sprint=N`（cases/run/regression 必需；final/final-regression 禁止缩小到单 sprint）
- `--revise`（仅 cases；SA 打回后按最新 `sa-test-review.md` 修订既有 Sprint 章节）

## 执行步骤

### 1. 解析参数 + 定位文件

```bash
PHASE=$1
REQ_NUM=$2
SPRINT=$(echo "$@" | grep -oE 'sprint=[0-9]+' | cut -d= -f2)
[ -n "$CC_NEXS_REQ_DIR" ] && REQ_DIR="$CC_NEXS_REQ_DIR" || REQ_DIR=$(ls -d all-docs/doc/${REQ_NUM}*/ | head -1)
```

### 2. 按 phase 分派

调起独立 `qa-claude` agent，按 `agents/qa-claude.md` 的模式执行。Codex runtime 将其映射为原生隔离 agent；Pi full mode 不在 P2 支持范围。

#### phase=cases

```
QA 起草 Sprint M${SPRINT} 测试用例。
读 ${REQ_DIR}spec.md（AC 表 M${SPRINT} 子集）+ ${REQ_DIR}api-doc.md。
append 到 ${REQ_DIR}test-cases.md 的 ## Sprint M${SPRINT} 章节。
契约覆盖率 100%（所有 AC 被 P0/P1 覆盖），边界 + 异常齐全。
禁读 src/ 和 sa-*.md（sa-test-review.md 例外）。

传入 --revise 时，必须读取 sa-test-review.md 最新一轮 NEEDS_REVISION，逐项修订 Sprint M${SPRINT} 的既有用例并记录修订轮次；不得原样重复追加旧用例。完成后由 Orchestrator 回到 QA_CASES，再派发 SA 新轮次复审。
```

#### phase=run

```
QA 执行 Sprint M${SPRINT} 测试。
读 ${REQ_DIR}test-cases.md ## Sprint M${SPRINT} 章节中 auto 的 P0/P1。
真实跑（API：newman/curl，单元：mvn test，E2E：Playwright）。
bug 落 ${REQ_DIR}bugs/BUG-<N>.md（必含可复现脚本到 qa-scripts/）。
append 到 ${REQ_DIR}test-report.md ## Sprint M${SPRINT} Round 1。
必须输出「AC-ID × 用例 × 结果」覆盖审计表。
末尾 结论: 通过 或 阻塞。
QA 物理不可为的标"待人工接入"，不算阻塞。
禁读 src/ 和 sa-code-review.md，禁改代码。
```

#### phase=regression

```
QA 回归 Sprint M${SPRINT}。
读 ${REQ_DIR}bugs/ 下 Sprint M${SPRINT} 相关 + 状态 FIXED 的 BUG。
重跑每个 BUG 的 qa-scripts/BUG-<id>-repro.*。
通过则改 BUG 状态 FIXED → VERIFIED。
失败则保留 FIXED，append 失败原因到 BUG 文件回归记录。
重跑本 sprint P0/P1（防回归）。
append 到 ${REQ_DIR}test-report.md ## Sprint M${SPRINT} 回归 Round R。
末尾 结论: 通过 或 阻塞 + 失败 BUG 清单。
```

#### phase=final

```
QA 在完整 candidate 已发布到 test 后执行需求级首次验收。
读全部 Sprint 的 AC 与 test-cases.md 累计用例，不读 src/ 或 sa-*.md。
从 release.test.app_url / operations_url 进入测试环境；只访问 allowed_hosts，并复用当前已登录浏览器会话。
Claude 使用 chrome-devtools-mcp，Codex 使用当前浏览器会话。Pi 优先通过 ego lite 的 `ego-browser` skill/CLI 在隔离 task Space 中验证；ego lite 不可用时，才使用配置为 `browser_use: true`、`headless: true` 的 computer-use 专用 Verifier，且同一 release attempt 不得切换 provider。
执行全部 P0/P1 auto、跨 Sprint 集成路径和必要 UI/运维台检查。
append 到 test-report.md 的 ## Final Release R<N> 章节，记录 release attempt、environment_revision 和证据引用。
发现问题创建 BUG 文件与复现资产，状态 OPEN。任何必需 P0/P1 未执行或失败都必须结论: 阻塞，不能以“待人工接入”冒充通过。
末尾必须 结论: 通过 或 阻塞。
```

#### phase=final-regression

```
QA 仅在修复 candidate 重新发布到 test 后执行需求级回归。
校验当前 release attempt/environment_revision 与上一轮不同。
重跑所有 FIXED BUG 复现资产、受影响 P0/P1、跨 Sprint 集成路径和全量 P0 冒烟。
只有本轮部署后复现与回归全部通过，才可把 BUG 从 FIXED 改为 VERIFIED。
append 到 test-report.md 的 ## Final Regression Release R<N> 章节并记录环境证据。
末尾必须 结论: 通过 或 阻塞。
```

### 3. 解析结果

```bash
# 抓 test-report.md 末尾结论
RESULT=$(tail -20 ${REQ_DIR}test-report.md | grep -E '^结论:' | tail -1 | awk '{print $2}')

# 统计 BUG 状态
OPEN=$(grep -l '状态.*OPEN' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
FIXED=$(grep -l '状态.*FIXED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)
VERIFIED=$(grep -l '状态.*VERIFIED' ${REQ_DIR}bugs/BUG-*.md 2>/dev/null | wc -l)

echo "RESULT:${RESULT} OPEN=${OPEN} FIXED=${FIXED} VERIFIED=${VERIFIED}"
```

### 4. 不推进状态

由 `/cc-nexs:run` 读结论 + BUG 计数后推进，并把 final/final-regression 结果绑定到当前 release attempt。QA 不直接写 progress。

## 输出

```
✅ QA 完成: phase=<phase> sprint=M<N>
   结论: <通过|阻塞>
   BUG: OPEN <x> / FIXED <y> / VERIFIED <z>
   契约覆盖: <AC 命中 / AC 总数>
   待人工接入: <数量>
👉 接下来: /cc-nexs:run <编号>
```
