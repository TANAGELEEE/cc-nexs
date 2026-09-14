---
name: "md-aggregation"
description: "cc-nexs 文档聚合规则速查。避免文件泛滥（每轮一个 md 文件的反模式）。触发词：sa-review、sa-code-review、test-report、acceptance、append、文件命名、追加、文档泛滥。"
disable-model-invocation: true
---

# md 文档聚合规则

按当前模式聚合：Lean 将执行、Review 与验证证据写入 plan.md，Hotfix 写入 hotfix.md；只有 Fast/Full 使用下表的分角色文档。不要把历史模式的文件清单套到 Lean/Hotfix。

Fast/Full 同类评审、测试和验收轮次追加到对应文件，用二级标题分隔。

## 一需求一文件清单

| 文件 | 角色产出 | 章节切分维度 |
|------|---------|-------------|
| `sa-review.md` | SA | `## Round N - YYYY-MM-DD - 结论` |
| `sa-test-review.md` | SA | `## Sprint M<N> Round N - YYYY-MM-DD - 结论` |
| `sa-code-review.md` | SA | `## Sprint M<N> - Round R - Group A - YYYY-MM-DD - 结论` |
| `test-cases.md` | QA | `## Sprint M<N>` |
| `test-report.md` | QA | `## Sprint M<N> Round N` 和 `## Sprint M<N> 回归 Round N` |
| `acceptance.md` | Evaluator | `## Sprint M<N> - YYYY-MM-DD` 和 `## 最终验收 - YYYY-MM-DD` |
| `dev-plan.md` | PM/Tech Lead | `## Sprint M<N>` |
| `api-doc.md` | Tech Lead | `## Sprint M<N>` |
| `deploy.md` | Tech Lead | `## Sprint M<N>` 和 `## 生产回滚步骤 - BUG-<id>`（如适用） |

## 反模式（禁止）

```
❌ sa-code-review-m2-a.md
❌ sa-code-review-m2-a-r2.md
❌ sa-code-review-m2-a-r3.md
❌ test-report-sprint1.md
❌ test-report-sprint1-round2.md
❌ acceptance-final.md
```

正确：

```
✅ sa-code-review.md（单文件，多 sprint × 多 round × 多 group 都 append 进去）
✅ test-report.md（同上）
✅ acceptance.md（同上）
```

## 文件顶部状态表

`sa-code-review.md`、`test-report.md` 这种轮次多的文件，**必须**在文件顶部维护一张状态表（agent 每次 append 后更新）：

```markdown
# {编号} {短名} SA 代码评审

## 评审状态

| Sprint | Group | Round | 日期 | 结论 |
|--------|-------|-------|------|------|
| M1 | A | 1 | 2026-05-17 | NEEDS_REVISION |
| M1 | A | 2 | 2026-05-18 | PASS |
| M2 | A | 1 | 2026-05-19 | PASS |

---

## Sprint M1 - Round 1 - Group A - 2026-05-17 - NEEDS_REVISION
（具体评审内容...）

## Sprint M1 - Round 2 - Group A - 2026-05-18 - PASS
（具体评审内容...）
```

## append 不覆盖

- 历史轮次内容**禁止删改**
- 修订只在文件末尾追加新章节
- 状态表顶部更新即可，不要删历史行
- 已 PASS 的 Sprint × Group 下一轮只审新增 diff，不重复审

## 历史归档

确实需要保留单独档案的（极少数特殊场景），归档到：

```
doc/<编号>/sa-review-archive/
doc/<编号>/test-report-archive/
```

`README.md` **不引用** archive 目录。这是冷存档，不影响当前流水线。

## 与 orchestrator 的接口

保留当前命令和 active run rule 要求的章节与末尾结论行。仅由确定性控制器更新 progress.json；Markdown 是证据或镜像，不从通用 tail/grep 片段推断跨模式状态。修复后的结论必须绑定当前 candidate，不复用旧 PASS。
