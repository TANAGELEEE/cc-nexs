# 测试报告 — {编号}.{需求短名}

> **负责人**：QA（Codex，黑盒）
> **本文件产出**：执行记录 + 覆盖审计。**不做验收结论**——验收结论在 acceptance.md（Evaluator 产）。
> **规则**：按 sprint × round append，同一文件承载全部轮次。

---

## 状态汇总

| Sprint | Round | 日期 | 执行结果 | Bug 数 |
|--------|-------|------|---------|--------|
| M1     | 1     | YYYY-MM-DD | 阻塞 | 3 |
| M1     | 回归 1 | YYYY-MM-DD | 通过 | 0 |
| M2     | 1     |  |  |  |

---

## Sprint M1 Round 1 — YYYY-MM-DD

### 执行范围
- 用例：TC-M1-001 ~ TC-M1-015（P0/P1 共 10 条）
- 自动化脚本：`qa-scripts/TC-M1-*.sh`
- 未执行：TC-M1-016（manual，标记待人工接入）

### AC-ID × 用例 × 结果 覆盖审计

| AC-ID | 用例 | 结果 | 脚本 |
|-------|------|------|------|
| AC-001 | TC-M1-001 | 通过 | qa-scripts/TC-M1-001.sh |
| AC-001 | TC-M1-002 | 失败 → BUG-001 | qa-scripts/TC-M1-002.sh |
| AC-002 | TC-M1-003 | 通过 | qa-scripts/TC-M1-003.sh |
| AC-003 | TC-M1-004 | 失败 → BUG-002 | qa-scripts/TC-M1-004.sh |
| AC-NF-001 | TC-M1-P-001 | 通过 | qa-scripts/TC-M1-P-001.sh |
| AC-NF-002 | TC-M1-S-001 | 通过 | qa-scripts/TC-M1-S-001.sh |

### 发现的 Bug
- BUG-001（P0）：见 `bugs/BUG-001.md`
- BUG-002（P1）：见 `bugs/BUG-002.md`
- BUG-003（P2）：见 `bugs/BUG-003.md`

### 覆盖判定
- 本 sprint AC 覆盖率：100%（所有 AC-ID 至少 1 条 P0/P1 用例）
- 代码行覆盖：XX%（不硬卡）
- 主动放弃覆盖的路径：
  - 路径：XXX。理由：属于降级场景，需要生产依赖不可在测试环境模拟，列"待人工接入"。

### 待人工接入
- [ ] 类型：QA 物理不可为 — 生产冒烟
  - 动作：拉灰度流量跑 TC-M1-016
  - 建议执行人：运维 + PM

### 结论
**结论: 阻塞**（3 个 bug 待修复，回第 6 步）

---

## Sprint M1 回归 Round 1 — YYYY-MM-DD

### 执行范围
- 状态为 FIXED 的 BUG：BUG-001, BUG-002, BUG-003
- 复现脚本重跑 + 本 sprint 关联 P0/P1 用例重跑

### 结果
| BUG | 复现脚本 | 结果 | 状态变更 |
|-----|---------|------|---------|
| BUG-001 | bugs/BUG-001-repro.sh | 通过 | FIXED → VERIFIED |
| BUG-002 | bugs/BUG-002-repro.sh | 通过 | FIXED → VERIFIED |
| BUG-003 | bugs/BUG-003-repro.sh | 通过 | FIXED → VERIFIED |

### 防回归用例重跑
- TC-M1-001 ~ TC-M1-015 全部 P0/P1：通过
- 新发现 bug：无

### 结论
**结论: 通过**（本 sprint 可进入 Evaluator 验收）

---

## Sprint M2 Round 1 — YYYY-MM-DD

（按同结构 append）

---

## FINAL — 全量汇总

> 仅在所有 sprint 回归通过后 append。
> **本节不做验收结论**，仅汇总执行面数据供 Evaluator 参考。

### 总量统计
- 用例总数：
- 通过率：
- Bug 总数 / 修复率：
- 覆盖的 AC-ID：N/N

### 遗留待人工接入清单
（合并各 sprint 的"待人工接入"）

### 移交给 Evaluator
- spec.md 验收契约（全部 AC-ID）
- 本文件各 sprint 执行记录
- bugs/ 下 VERIFIED 列表

**结论: 通过**（执行层面——最终验收以 acceptance.md 为准）
