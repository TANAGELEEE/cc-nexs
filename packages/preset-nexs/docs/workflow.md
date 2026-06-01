# 全流程时序与契约

本文档定义每个状态的输入/输出契约。orchestrator 严格按契约推进，不满足契约的状态转移会被拒绝。

## 状态契约表

| 状态 | 入态前置（必满足） | 出态产物（必产出） | 解析判据（orchestrator 用） |
|------|-------------------|-------------------|---------------------------|
| INIT | `all-docs/doc/<编号>/` 目录存在；本目录至少含 templates 文件骨架 | `requirements.md` 非空 | 文件大小 > 100 字节 |
| REQ_DRAFTED | `requirements.md` 非空 | `repo-context.md` 含 8 章节、至少一条带行号引用 | grep `## .*(领域关键词\|同类配置\|风险提示)` |
| RECON_DONE | `repo-context.md` 章节齐全 | `spec.md` 含五章节，"现状对照"小节非空 | grep `## (业务背景\|技术方案\|影响范围\|验收契约\|Sprint 切片)` + grep `### 现状对照` |
| SPEC_DRAFTED | `spec.md` 五章节齐全；AC ≥ 5 条；"现状对照"小节非空 | `sa-review.md` 末尾结论行 | `tail -20 sa-review.md \| grep -E '^结论:'` |
| SPEC_REVIEWING | sa-codex 调用已完成 | 同上 | PASS → SPEC_PENDING_HUMAN<br>NEEDS_REVISION → SPEC_NEEDS_REVISION |
| SPEC_NEEDS_REVISION | sa-review.md 有 NEEDS_REVISION 轮次 | 修订后的 spec.md + 变更记录 +1 行 | spec.md 变更记录新增"根据 SA Round N 修订" |
| **SPEC_PENDING_HUMAN** | sa-review.md 末轮 PASS | 摘要输出后等待 `/cc-nexs:approve-spec` | progress.md 的 human_approved_at != null |
| SPEC_APPROVED | progress.md.human_approved_at 非空 | 设 current_sprint=1 | — |
| SPRINT_<N>_KICKOFF | spec.md 中 Sprint M<N> 切片定义存在 | 启动 QA 写用例和 Tech Lead 编码 | — |
| SPRINT_<N>_QA_CASES | (并行步骤) | `test-cases.md ## Sprint M<N>` 章节，所有 AC<N> 至少一条 P0/P1 用例 | `grep -c '关联.*AC-' test-cases.md ## Sprint M<N>` ≥ AC 数量 |
| SPRINT_<N>_DEV | spec.md M<N> 切片 + (可选) test-cases.md M<N> | 代码 commit + `mvn compile` = 0 + 无中文字符串 | `mvn compile` 退出码 0 |
| SPRINT_<N>_SA_TEST_REVIEW | test-cases.md M<N> 章节 | sa-test-review.md M<N> Round N 结论 | 末尾 `结论: PASS\|NEEDS_REVISION` |
| SPRINT_<N>_DOC_SYNC | sprint 编码完成 | api-doc.md M<N> + deploy.md M<N>（含回滚） | `grep -E '^## Sprint M<N>' api-doc.md deploy.md` |
| SPRINT_<N>_SA_CODE | mvn compile = 0 + diff 准备好 | sa-code-review.md M<N> Round R 结论 | 末尾 `结论: PASS\|NEEDS_REVISION` |
| SPRINT_<N>_QA_RUN | sa-code-review.md M<N> 末轮 PASS | test-report.md M<N> Round 1 结论 + AC×用例×结果覆盖审计表 | 末尾 `结论: 通过\|阻塞` |
| SPRINT_<N>_FIX | bugs/ 下有 OPEN BUG | 对应 BUG.状态 = FIXED + 修复 commit | grep `状态.*FIXED` BUG-*.md |
| SPRINT_<N>_QA_REGRESSION | bugs/ 下有 FIXED BUG | 对应 BUG.状态 = VERIFIED + 回归记录 append | grep `状态.*VERIFIED` |
| SPRINT_<N>_EVAL | bugs/ 全 VERIFIED + test-report 通过 + **产物完整性 gate**（deploy.md/api-doc.md/test-report.md 非模板内容） | acceptance.md M<N> 章节 + 契约打分表 | 末尾 `验收结果: 通过\|未通过` |
| SPRINT_<N>_DONE | acceptance.md M<N> 末尾通过 | progress.md.sprint_status[M<N>] = done | — |
| ALL_SPRINTS_DONE | 所有 sprint 状态 done | — | — |
| FINAL_EVAL | ALL_SPRINTS_DONE | acceptance.md 最终章节 + 跨 sprint 全量打分 | 末尾 `验收结果: 通过\|未通过` |
| COMPLETE | acceptance.md 最终通过 | 输出最终报告 | — |

## 时序图（一个完整需求的生命周期）

```
[Day 1]
人:  cp -r templates/ all-docs/doc/01.feature/ && 填 requirements.md
人:  /cc-nexs:run 01
机:  INIT → REQ_DRAFTED → RECON_DONE → SPEC_DRAFTED
     先调起 Repo Scout session → 扫 src/ 产 repo-context.md
     再调起 Planner-Claude session（必读 requirements + repo-context）→ 产 spec.md
机:  → SPEC_REVIEWING
     调起 SA-Codex → 产 sa-review.md
机:  → 解析结论 → PASS → SPEC_PENDING_HUMAN
     ⏸️ 输出摘要 + return

[Day 1, 30 分钟后]
人:  审 spec.md → 满意
人:  /cc-nexs:approve-spec 01
机:  SPEC_PENDING_HUMAN → SPEC_APPROVED

人:  /cc-nexs:run 01
机:  → SPRINT_1_KICKOFF
     并行：
       QA-Codex 写 test-cases.md M1
       Tech Lead-Claude 写代码
机:  → SPRINT_1_DEV → mvn compile ✅
机:  → SA_TEST_REVIEW → SA-Codex 评审 cases → PASS
机:  → DOC_SYNC → Tech Lead 同步 api-doc + deploy
机:  → SA_CODE → SA-Codex 评审 diff → NEEDS_REVISION
       sa_code_revision_count = 1
机:  → SPRINT_1_DEV (再修)
机:  → SA_CODE → PASS
机:  → SPRINT_1_QA_RUN → QA-Codex 跑 P0/P1 → 发现 BUG-001
机:  → SPRINT_1_FIX → Tech Lead 修 → BUG-001 FIXED
机:  → SPRINT_1_QA_REGRESSION → 通过 → BUG-001 VERIFIED
机:  → SPRINT_1_EVAL → Evaluator-Codex 打分 → 通过
机:  → SPRINT_1_DONE → SPRINT_2_KICKOFF
     ...
机:  → ALL_SPRINTS_DONE → FINAL_EVAL → 通过 → COMPLETE
机:  输出最终报告（已完成清单 + 待人工接入：部署 + 合并按钮）

[Day 2]
人:  人工 review 最终报告 → git push → gh pr create → merge

[Day 2，可选]
人:  /cc-nexs:compound 01    ← 旁路命令，不进状态机
机:  调起 compound-claude session（独立）
     扫 all-docs/doc/01.feature/* 检查 5 项强信号：
       - 同 BUG 修 ≥ 2 次？
       - 同类 SA 反馈跨 ≥ 2 sprint？
       - RECON 现状假设被推翻？
       - 验收驳回？
       - spec 变更记录 ≥ 3 行？
     命中任一 → 产 docs/solutions/<topic>.md
     全部不命中 → compound-summary.md 写"跳过"，docs/solutions/ 不动
机:  下次同类需求 RECON 阶段 Repo Scout grep docs/solutions/，命中即接入
     repo-context.md "## 7.6 既往教训命中"，Planner 第一稿就避坑（复利）
```

## 异常路径

### 路径 A：spec NEEDS_REVISION 循环

```
SPEC_DRAFTED → SPEC_REVIEWING → SPEC_NEEDS_REVISION → SPEC_DRAFTED → SPEC_REVIEWING → PASS
```

无人工介入。Planner-Claude 读 sa-review.md 自动修订。

### 路径 B：SA 代码评审熔断

```
SPRINT_1_DEV → SA_CODE → NEEDS_REVISION (count=1)
SPRINT_1_DEV → SA_CODE → NEEDS_REVISION (count=2)
SPRINT_1_DEV → SA_CODE → NEEDS_REVISION (count=3)
🛑 熔断：SPEC_REVIEWING (强制 Planner 重审方案)
```

熔断后 Planner 在 spec.md 加 `## 熔断后修订` 子节，再走一遍 SA → 人工 gate（如方案有改动）→ Sprint 编码。

### 路径 C：QA 反复修同一 BUG

```
SPRINT_1_QA_RUN → BUG-007 OPEN
SPRINT_1_FIX → FIXED → REGRESSION → 失败 (qa_fix_count[BUG-007]=1)
SPRINT_1_FIX → FIXED → REGRESSION → 失败 (count=2)
SPRINT_1_FIX → FIXED → REGRESSION → 失败 (count=3)
🛑 熔断：SPRINT_1_TECH_LEAD_REVIEW
        BUG-007 升级 P0
        Tech Lead 重评实现路径
```

### 路径 D：Evaluator 拒收

```
SPRINT_2_EVAL → 未通过 (count=1)
回退到 SPRINT_2_FIX 或 SPRINT_2_DEV (按 acceptance 建议)
SPRINT_2_EVAL → 未通过 (count=2)
🛑 熔断：SPEC_REVIEWING
```

### 路径 E：物理不可为

```
SPRINT_2_QA_RUN → 真机 UI 验收 → QA 标"待人工接入"
不算阻塞，QA 继续跑其他用例
test-report.md 保留"待人工接入"清单
最终 acceptance.md 也保留这一清单
COMPLETE 后人工拉取清单去做线下验证
```

## 输入文件契约

### requirements.md（PM 写）

至少包含：
- 业务诉求一段话
- 关键场景（用户故事，1-3 条）
- 验收要点（业务视角，PM 自己关心的成功标准）
- 紧迫程度 / 依赖

格式不强制，但 Planner 解析不到任何业务诉求会抛错回退给人工。

### spec.md（Planner 产出）

五章节硬性：

```markdown
## 业务背景
（≤ 200 字）

## 技术方案
（含 ASCII 架构图、依赖现有组件、新增类/表、关键决策 ⚠️）

## 影响范围
（涉及子工程、API、DB schema、破坏点）

## 验收契约
| AC-ID | 描述 | Given | When | Then | 关联 Sprint |
（≥ 5 条）

## Sprint 切片
| Sprint | 覆盖 AC-ID | 预估 diff | 预估 commit | 备注 |
（每片 ≤ 1500 行 / ≤ 10 commit）

## 变更记录
| 日期 | 内容 | 原因 | 影响范围 |
```

### test-cases.md（QA 产出，按 sprint append）

```markdown
## Sprint M1

### TC-M1-001: <标题>
- 关联 AC: AC-001, AC-003
- 优先级: P0
- 类型: auto
- 前置: ...
- 步骤: ...
- 期望: ...
```

### test-report.md（QA 产出）

```markdown
## Sprint M1 Round 1

### 覆盖审计

| AC-ID | 用例 ID | 结果 | BUG-ID |
|-------|---------|------|--------|
| AC-001 | TC-M1-001 | 通过 | — |
| AC-002 | TC-M1-002 | 阻塞 | BUG-001 |

### 详情
（每用例的执行日志、命令、退出码）

### 待人工接入
- TC-M1-005: 真机 UI 验收（QA 物理不可为）

结论: 阻塞
```

### acceptance.md（Evaluator 产出）

```markdown
## Sprint M1 - 2026-05-17

### 契约打分

| AC-ID | 描述 | 关联用例 | 用例结果 | 打分 | 理由 |
|-------|------|---------|---------|------|------|
| AC-001 | ... | TC-M1-001 | 通过 | ✅ | 边界 + 异常齐全 |
| AC-002 | ... | TC-M1-002 | 阻塞 | ❌ | BUG-001 复发 |

### 未通过条目
（阻塞分析）

### 建议回退
（具体到状态：回 SPRINT_1_FIX 或 SPRINT_1_DEV）

验收结果: 未通过
```

## 与 README 同步

每次 `transitionState(...)` 之后 orchestrator 自动调 `syncFeatureReadme({ reqDir })`，把 `all-docs/doc/<id>/README.md` 的 `<!-- AUTOGEN:status START/END -->` 区段刷新为最新进度（当前状态 / 产物索引 / 契约覆盖快照 / 待人工接入）。锚点外的"下一步动作（人工维护）"小节保留人工编辑。这兑现了 README 模板"进入目录第一件事：读本文件"的承诺——用户每次进 worktree 看到的都是 fresh state。

旧 `all-docs/doc/<id>/README.md` 没有 AUTOGEN 锚点的会被自动跳过 + 输出 warn，不强改。要恢复自动同步，从模板重建该文件即可。

## 与 hooks 协同

每次状态转移 orchestrator 写 progress.md 的同时，可能触发 hook：

- `SPEC_DRAFTED → SPEC_REVIEWING`：sa-codex 调用（hook 检查角色身份）
- `SPRINT_<N>_DEV → SA_TEST_REVIEW`：mvn compile 调用（hook 检查中文字符串）
- `COMPLETE → 人工合并`：git push 调用（hook 检查 progress.md = COMPLETE）

## 可观测

- 所有状态转移在 progress.md "历史轨迹" 段留痕
- 所有评审/测试/验收 append 到对应 md，保留全部历史轮次
- BUG 状态从 OPEN → FIXED → VERIFIED 全过程可追溯
- 熔断记录在 spec.md "变更记录" 和 progress.md "历史轨迹" 双重落库

## fast 模式状态契约（0.3.0+）

由 `all-docs/doc/<id>/config.json.mode = "fast"` 触发，单 sprint 强制，无 SPRINT_<N>_* 命名。

### 状态契约表

| 状态 | 入态前置 | 出态产物 | 解析判据 |
|------|---------|---------|---------|
| INIT | `all-docs/doc/<编号>/` 已建 | requirements.md 非空 | 文件大小 > 100 字节 |
| REQ_DRAFTED | requirements.md 非空 | spec.md 五章节齐全 | grep `## (业务背景\|技术方案\|影响范围\|验收契约\|Sprint切片)`；fast 模式 AC ≥ 3 即可 |
| SPEC_DRAFTED | spec.md 五章节齐全；AC ≥ 3 条 | sa-review.md 末尾结论行 | `tail -20 sa-review.md \| grep -E '^结论:'` |
| SPEC_REVIEWING | reviewer codex 已完成 | 同上 | PASS → SPEC_PENDING_HUMAN<br>NEEDS_REVISION → SPEC_NEEDS_REVISION（review_revision++）|
| SPEC_NEEDS_REVISION | sa-review.md 有 NEEDS_REVISION 轮次 | 修订后 spec.md + 变更记录 +1 行 | spec.md "变更记录" 新增 |
| **SPEC_PENDING_HUMAN** | sa-review.md 末轮 PASS | 摘要输出 + 等 `/cc-nexs:approve-spec` | progress.md.human_approved_at != null |
| SPEC_APPROVED | human_approved_at 非空 | — | — |
| BUILD | spec.md 五章节齐全 + 已 approved | 代码 commit + mvn compile = 0 + 无中文字符串 + dev-plan/api-doc/deploy 各 append M1 章节 | mvn compile 退出码 0；`grep -E '^## Sprint M1' api-doc.md deploy.md` |
| TEST | BUILD 完成 | test-cases.md ## Sprint M1 + qa-scripts/ 脚本 + test-report.md ## Sprint M1 Round 1 + 覆盖审计表 | 末尾 `结论: 通过\|阻塞`；通过 → TEST_PASSED，阻塞 → TEST_BLOCKED |
| TEST_BLOCKED | test-report.md 阻塞 + 至少一个 OPEN BUG | — | — |
| FIX | bugs/ 下有 OPEN BUG | BUG.状态 = FIXED + 修复 commit + mvn compile = 0 | grep `状态.*FIXED` BUG-*.md |
| REGRESSION | bugs/ 下有 FIXED BUG | BUG.状态 = VERIFIED + test-report ## Sprint M1 回归 Round R | grep `状态.*VERIFIED`；末尾结论；阻塞 → fix_per_bug++ |
| TEST_PASSED | test-report 末尾通过 | — | — |
| ACCEPT | TEST_PASSED | sa-code-review.md ## Sprint M1 - Round R 结论 + acceptance.md ## Sprint M1 + 最终验收 章节 + 契约打分表 | 同时解析两个文件末尾结论行 |
| ACCEPT_NEEDS_REVISION | code NEEDS_REVISION 或 验收未通过 | 修订后回 BUILD | review_revision 或 evaluator_reject 计数器 ++ |
| HUMAN_INTERVENTION | 同 BUG fix_per_bug ≥ 2 | 停下要人工介入 | stop=true，orchestrator 输出当前 BUG 上下文后 return |
| COMPLETE | code PASS + 验收通过 | 输出最终报告 | — |

### fast 模式典型时序

```
[Day 1]
人:   /cc-nexs:init "添加 /api/health 健康检查接口"
人:   编辑 config.json: "mode": "fast"
人:   编辑 requirements.md
人:   /cc-nexs:run 01

机:   INIT → REQ_DRAFTED → SPEC_DRAFTED
      调起 fullstack-claude（独立 session，phase=spec）→ spec.md
机:   → SPEC_REVIEWING
      调起 reviewer-codex（target=spec）→ sa-review.md PASS
机:   → SPEC_PENDING_HUMAN ⏸️ 输出摘要 + return

人:   /cc-nexs:approve-spec 01

人:   /cc-nexs:run 01
机:   → SPEC_APPROVED → BUILD
      调起 fullstack-claude（phase=build）→ src/* + dev-plan + api-doc + deploy
      mvn compile = 0 + 无中文字符串
机:   → TEST
      调起 verifier-codex（mode=initial）→ test-cases + qa-scripts + test-report
      末尾通过
机:   → TEST_PASSED → ACCEPT
      调起 reviewer-codex（target=accept）→ sa-code-review + acceptance（一次完成）
      代码 PASS + 验收通过
机:   → COMPLETE
```

### 阻塞 / 修复路径

```
机:   → TEST → 阻塞（BUG-001）→ TEST_BLOCKED → FIX
      调起 fullstack-claude（phase=fix --bug=BUG-001）→ BUG-001.状态=FIXED
机:   → REGRESSION
      调起 verifier-codex（mode=regression）→ BUG-001.状态=VERIFIED + 回归通过
机:   → TEST_PASSED → ACCEPT → COMPLETE
```

### 熔断路径

```
机:   → ACCEPT → 代码 NEEDS_REVISION → ACCEPT_NEEDS_REVISION (review_revision=1)
机:   → BUILD → TEST → ACCEPT → 代码 NEEDS_REVISION (review_revision=2)
🛑   熔断：回 SPEC_REVIEWING，Fullstack 按 sa-code-review.md 反馈重写方案
```

```
机:   → FIX (BUG-007) → REGRESSION → 失败 (fix_per_bug[BUG-007]=1)
机:   → FIX → REGRESSION → 失败 (fix_per_bug[BUG-007]=2)
🛑   熔断：HUMAN_INTERVENTION，停下要人工
```
