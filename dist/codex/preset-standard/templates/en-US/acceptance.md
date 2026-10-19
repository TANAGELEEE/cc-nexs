# Acceptance Report — {id}.{feature-slug}
> **Owner**: Evaluator (Codex independent session, **must not** share a session with QA)
> **Do not read**: src/, sa-code-review.md, sa-review.md, sa-test-review.md
> **May read**: spec.md (acceptance contract), test-report.md, files in bugs/ with status VERIFIED
> **Output rules**: Append by sprint, one scorecard per sprint; after all sprints pass, append the final section.

---
## Status Summary

| Sprint | 日期 | AC 通过/总数 | 未通过 AC-ID | 结果 |
|--------|------|-------------|-------------|------|
| M1     | YYYY-MM-DD | 0/0         |             | Pending acceptance |
| M2     | YYYY-MM-DD | 0/0         |             | Pending acceptance |
| FINAL  | YYYY-MM-DD | 0/0         |             | Pending acceptance |

---

## Sprint M1 - YYYY-MM-DD

### Scoring Table

| AC-ID | 描述 | 关联用例 | 用例结果 | 打分 | 理由 |
|-------|------|---------|---------|------|------|
| AC-001 | （Copy the description summary from spec.md） | TC-01, TC-02 | Pass | ✅ | Covers the main path + 2 boundary cases |
| AC-002 |                            | TC-03        | Pass | ✅ |                      |
| AC-003 |                            | TC-04        | Failed | ❌ | Concurrency scenario not covered |
| AC-NF-001 |                         | perf-01      | Pass | ✅ | P99 = 180ms |
| AC-NF-002 |                         | sec-01       | Pass | ✅ |              |
**Legend**: ✅ Pass / ❌ Fail / ⚠️ Pass with reservations (must be explained in the Reason column)
### Failure Analysis
(Required for each failed AC.)

**AC-003**
- Gap: The test cases cover only single-threaded execution and do not test multi-threaded concurrent writes.
- Impact: Dirty data may occur in production when QPS > 50.
- Suggested action: Return to Step 6 (Tech Lead adds the lock), or Step 3a (QA adds concurrency test cases).
- Suggested owner: QA adds test cases (a distributed lock is already implemented on the code side).
### Outstanding Risks
- (Items that pass this sprint but are retained with a ⚠️; state the risk)
### Manual Follow-up (This Sprint)
- [ ] Type: <QA physical infeasibility / Agent closed-loop 2-category production operation / ...>
  - Project:
  - Reason:
  - Suggested person to involve:
### Conclusion
**Acceptance Result: Not Passed**

(Pass or fail must be stated explicitly. After a failure, this sprint does not proceed to the next sprint.)

---
## Sprint M2 - YYYY-MM-DD
(Same structure as above, just append)

---
## FINAL - Full Acceptance - YYYY-MM-DD
> Produce this only after every sprint individually shows `验收结果: 通过`.
> This section is the final external delivery evidence; **exclude internal terminology**—do not mention SA-Codex / QA-Codex / Evaluator / the heterogeneous four-party setup.
### Full Cross-Sprint Contract Scoring

| AC-ID | 所属 Sprint | 打分 | 备注 |
|-------|------------|------|------|
| AC-001 | M1 | ✅ |      |
| ...    |    |    |      |
**Statistics**:
- Total AC count: N
- Passed: N (100%)
- Retained pass ⚠️: 0
- Not passed: 0
### Outstanding Risk Overview
| Risk Item | Impact Scope | Trigger Condition | Mitigation Measures |
|--------|---------|---------|---------|
|        |         |         |         |

### Manual Follow-up List
Group by type (distinguish whether something is physically impossible for QA, or an Agent closed-loop physical exception of type 1/3/4/5):

**Type 1 · Deployment / CI/CD trigger**
- [ ] Trigger the production pipeline (deploy.md §X)

**Type 2 · Production environment operations / physically impossible for QA**
- [ ] Production smoke test (checklist in test-report.md §Pending manual review)
- [ ] Business definition signed off by PM: XXX copy

**Type 3 · External accounts / credentials**
- [ ] Apply for the XXX key

**Type 5 · Final button for merging to main**
- [ ] Merge the feature/{id}-{feature-slug} branch
### Release Recommendation
- Recommended canary strategy:
- Observation metrics:
- Rollback triggers (linked to the rollback steps in deploy.md):
### Final Conclusion
**Acceptance result: Pass**
