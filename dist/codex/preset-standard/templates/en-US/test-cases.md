# Test Cases — {id}.{feature-slug}
**Owner**: QA (Codex, black-box)
**Do Not Read**: src/, sa-code-review.md, sa-review.md
> **Readable**: spec.md, api-doc.md, sa-test-review.md (read only when revising test cases)
> **产出规则**：按 sprint append `## Sprint Mₙ` 章节；每条用例反向引用 AC-ID。
> **硬判据**：本 sprint 所有 AC-ID 必须被至少一条 P0/P1 用例覆盖（契约覆盖率 100%）。

---
## Case ID Rules
- Format: `TC-{sprint}-{number}`, e.g. `TC-M1-001`
- The bug reproduction script number follows the test case: `qa-scripts/TC-M1-001.sh`

---
## Sprint M1

### Contract Coverage Audit

| AC-ID | 优先级 | 覆盖用例 |
|-------|--------|---------|
| AC-001 | P0 | TC-M1-001, TC-M1-002 |
| AC-002 | P0 | TC-M1-003 |
| AC-003 | P1 | TC-M1-004 |
| AC-NF-001 | P0 | TC-M1-P-001 |

### Functional Cases

#### TC-M1-001 — {case name}
- **Related contract**: AC-001
- **Priority**: P0
- **Automation**: auto
- **Preconditions**:
- **Input**:
- **Steps**:
- **Expected output**:
- **Checkpoints**:
  - [ ] HTTP 200
  - [ ] Response body `code == 0`
  - [ ] One new row added to DB table `xxx`
- **Script location**: `qa-scripts/TC-M1-001.sh`
#### TC-M1-002 — {case name}
- **Related contract**: AC-001 (boundary)
- **Priority**: P0
- **Automation**: auto
- ...
### Performance / Security / Compatibility Cases

#### TC-M1-P-001 — P99 Response-Time Load Test
- **Related contract**: AC-NF-001
- **Priority**: P0
- **Automation**: auto
- **Tools**: wrk / jmeter / k6
- **Scenario**:
- **Criteria**: P99 ≤ 200ms

---
## Sprint M2
(Append after completing M1)
