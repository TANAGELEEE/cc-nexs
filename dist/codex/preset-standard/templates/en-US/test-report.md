# Test Report — {id}.{feature-slug}
> **Owner**: QA (Codex, black-box)
> **Deliverables of this document**: execution record + coverage audit. **Does not draw acceptance conclusions**—acceptance conclusions are in acceptance.md (produced by Evaluator).
> **Rules**: Accumulate test cases during the Sprint phase; by default, append execution records by Final Release × Round only after the complete requirement is released to test. legacy per_sprint may retain the original sections.

---
## Status Summary

| Sprint | Round | Date | Execution Result | Bug Count |
|--------|-------|------|---------|--------|
| M1     | 1     | YYYY-MM-DD | Blocked | 3 |
| M1     | Regression 1 | YYYY-MM-DD | Pass | 0 |
| M2     | 1     |  |  |  |

---

## Sprint M1 Round 1 — YYYY-MM-DD

### Execution Scope
- Test cases: TC-M1-001 ~ TC-M1-015 (10 total across P0/P1)
- Automation scripts: `qa-scripts/TC-M1-*.sh`
- Not executed: TC-M1-016 (manual, marked pending manual integration)
### AC-ID × Case × Result Coverage Audit

| AC-ID | 用例 | 结果 | 脚本 |
|-------|------|------|------|
| AC-001 | TC-M1-001 | Passed | qa-scripts/TC-M1-001.sh |
| AC-001 | TC-M1-002 | Failed → BUG-001 | qa-scripts/TC-M1-002.sh |
| AC-002 | TC-M1-003 | Pass | qa-scripts/TC-M1-003.sh |
| AC-003 | TC-M1-004 | Failure → BUG-002 | qa-scripts/TC-M1-004.sh |
| AC-NF-001 | TC-M1-P-001 | Pass | qa-scripts/TC-M1-P-001.sh |
| AC-NF-002 | TC-M1-S-001 | Pass | qa-scripts/TC-M1-S-001.sh |

### Bugs Found
- BUG-001 (P0): see `bugs/BUG-001.md`
- BUG-002 (P1): see `bugs/BUG-002.md`
- BUG-003 (P2): see `bugs/BUG-003.md`
### Coverage Decision
- AC coverage this sprint: 100% (every AC-ID has at least 1 P0/P1 test case)
- Line coverage: XX% (not a hard gate)
- Paths intentionally left uncovered:
  - Path: XXX. Reason: this is a degradation scenario that requires production dependencies which cannot be simulated in the test environment; listed as "pending manual integration".
### Human Required
- [ ] Type: QA physically impossible — production smoke
  - Action: pull canary traffic to run TC-M1-016
  - Suggested assignee: Ops + PM
### Conclusion
**Conclusion: Blocked** (3 bugs to fix, return to step 6)
## Sprint M1 Regression Round 1 — YYYY-MM-DD

### Execution Scope
- Bugs with status FIXED: BUG-001, BUG-002, BUG-003
- Rerun reproduction scripts + rerun P0/P1 cases associated with this sprint
### Results
| BUG | Reproduction Script | Result | Status Change |
|-----|---------|------|---------|
| BUG-001 | bugs/BUG-001-repro.sh | Passed | FIXED → VERIFIED |
| BUG-002 | bugs/BUG-002-repro.sh | Pass | FIXED → VERIFIED |
| BUG-003 | bugs/BUG-003-repro.sh | Pass | FIXED → VERIFIED |

### Regression Case Reruns
- TC-M1-001 ~ TC-M1-015, all P0/P1: pass
- New bugs found: none
### Conclusion
**Conclusion: Passed** (this sprint can proceed to Evaluator acceptance)

---
## Sprint M2 Round 1 — YYYY-MM-DD
(Append using the same structure.)

---
## Final Release R1 — YYYY-MM-DD
> Run after the complete candidate is first released to test. Fix re-releases use `## Final Regression Release R<N>` and must not overwrite history.
### Release Evidence

| release attempt | environment_revision | pipeline | deployment | test URLs |
|---|---|---|---|---|
| test-release-1 |  |  |  |  |

### Cumulative Execution Scope
- All Sprint P0/P1:
- Cross-Sprint/cross-repo integration paths:
- Frontend/ops console browser checks:
- Required test cases not executed (if non-empty, the conclusion must be blocked):
### Aggregate Statistics
- Total test cases:
- Pass rate:
- Total bugs / fix rate:
- AC-IDs covered: N/N
### Outstanding Manual Follow-up List
(Optional/production-only items may be listed; required P0/P1 items must not be passed off as passing while awaiting manual integration)
### Handoff to Evaluator
- spec.md acceptance contract (all AC-IDs)
- Execution records for each sprint in this file
- VERIFIED list under bugs/

**Conclusion: Pass** (execution level; final contract acceptance is subject to acceptance.md)
