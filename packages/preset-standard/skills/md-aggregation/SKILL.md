---
name: "md-aggregation"
description: "cc-nexs document aggregation rules quick reference. Avoid file proliferation (the anti-pattern of one md file per round). Trigger words: plan.md evidence, BUG document, append, file naming, appending, document proliferation."
disable-model-invocation: true
---

# md Document Aggregation Rules

Lean writes execution, Review, and verification evidence into `plan.md`; Hotfix writes into the BUG document specified by `progress.hotfix_document` (`hotfix.md` for legacy tasks). Rounds of the same kind are appended to that one document under level-2 headings; never create one file per round.

```
❌ plan-review-r2.md
❌ test-round2.md
✅ plan.md（Review / Test 各轮次都 append 进对应章节）
```

## Interface with the orchestrator

Preserve the sections and trailing conclusion line required by the current command and the active run rule. Only the deterministic controller updates progress.json; Markdown is evidence or a mirror, and cross-mode state is not inferred from generic tail/grep fragments. A conclusion after a fix must be bound to the current candidate and must not reuse an old PASS.
