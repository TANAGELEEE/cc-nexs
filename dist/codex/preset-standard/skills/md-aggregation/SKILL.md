---
name: "md-aggregation"
description: "cc-nexs document aggregation rules quick reference. Avoid file proliferation (the anti-pattern of one md file per round). Trigger words: sa-review, sa-code-review, test-report, acceptance, append, file naming, appending, document proliferation."
disable-model-invocation: true
---

# md Document Aggregation Rules

Aggregate according to the current mode: Lean writes execution, Review, and verification evidence into plan.md, and Hotfix writes into the BUG document specified by `progress.hotfix_document` (hotfix.md for legacy tasks); only Fast/Full use the role-specific documents in the table below. Do not apply the file list from historical modes to Lean/Hotfix.

For Fast/Full, review, test, and acceptance rounds of the same kind are appended to the corresponding file, separated by level-2 headings.

## One File List per Requirement

| File | Role output | Section split dimension |
|------|---------|-------------|
| `sa-review.md` | SA | `## Round N - YYYY-MM-DD - 结论` |
| `sa-test-review.md` | SA | `## Sprint M<N> Round N - YYYY-MM-DD - 结论` |
| `sa-code-review.md` | SA | `## Sprint M<N> - Round R - Group A - YYYY-MM-DD - 结论` |
| `test-cases.md` | QA | `## Sprint M<N>` |
| `test-report.md` | QA | `## Sprint M<N> Round N` and `## Sprint M<N> 回归 Round N` |
| `acceptance.md` | Evaluator | `## Sprint M<N> - YYYY-MM-DD` and `## 最终验收 - YYYY-MM-DD` |
| `dev-plan.md` | PM/Tech Lead | `## Sprint M<N>` |
| `api-doc.md` | Tech Lead | `## Sprint M<N>` |
| `deploy.md` | Tech Lead | `## Sprint M<N>` and `## 生产回滚步骤 - BUG-<id>` (if applicable) |

## Anti-patterns (Prohibited)
```
❌ sa-code-review-m2-a.md
❌ sa-code-review-m2-a-r2.md
❌ sa-code-review-m2-a-r3.md
❌ test-report-sprint1.md
❌ test-report-sprint1-round2.md
❌ acceptance-final.md
```
Correct:
```
✅ sa-code-review.md（单文件，多 sprint × 多 round × 多 group 都 append 进去）
✅ test-report.md（同上）
✅ acceptance.md（同上）
```
## Status Table at the Top of the File

For files that go through many rounds, such as `sa-code-review.md` and test-report.md, **you must** maintain a status table at the top of the file (updated after each append by the agent):
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
## append Does Not Overwrite

- Content from previous rounds **must not be deleted or modified**
- Revisions only append new sections at the end of the file
- Just update the status table at the top; do not delete historical rows
- For a Sprint × Group that has already PASSED, review only the newly added diff in the next round; do not re-review

## Historical Archive

In the rare special cases where a separate archive genuinely needs to be retained, archive it to:
```
doc/<编号>/sa-review-archive/
doc/<编号>/test-report-archive/
```
`README.md` **does not reference** the archive directory. It is a cold archive and does not affect the current pipeline.

## Interface with the orchestrator

Preserve the sections and trailing conclusion line required by the current command and the active run rule. Only the deterministic controller updates progress.json; Markdown is evidence or a mirror, and cross-mode state is not inferred from generic tail/grep fragments. A conclusion after a fix must be bound to the current candidate and must not reuse an old PASS.
