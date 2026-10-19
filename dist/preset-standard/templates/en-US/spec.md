# Spec — {id}.{feature-slug}
> **Owner**: Planner (Codex)
> **Prohibited**: Planner does not write code, does not review code, and does not execute tests
> **Authoritative source**: This file. Changes to the business part go through requirements.md; technical + contract + slices go through this file.

---
## Business Context
(Extract the core business requirements from requirements.md; explain clearly in one paragraph "why we're doing this" and "who it's for." Do not copy the full text — keep only the business points the Planner must know to make technical decisions.)

- User roles:
- Trigger scenarios:
- Business goals:
- Non-goals (explicitly out of scope):

---
## Technical Plan

### Architecture Overview
(Module boundaries, call chains, data flow. One diagram + three sentences.)
### Key Design Decisions
| # | Decision Point | Options | Final Choice | Rationale |
|---|--------|------|---------|------|
| D1 |        |      |         |      |
| D2 |        |      |         |      |

### Data Model
(If data storage is involved, list the new/modified tables, fields, indexes, migration files, and rollback strategy; follow the project overlay for specific naming.)
### API Design
(List of publicly exposed API endpoints. See api-doc.md for detailed contracts; only the endpoint list and paths are listed here.)
### Third-Party Dependencies
(Newly added maven dependencies, external services, and environment variables. For each item, give one sentence on "why it's needed".)

---
## Impact Scope

### Code Impact
- New modules:
- Modified modules:
- Deprecated modules:
### Data Impact
- New tables/fields:
- Data migration:
- Rollback data risk:
### Interface Impact
- Newly added APIs:
- APIs with changed semantics (⚠️ breaks compatibility):
- Retired APIs:
### Operations Impact
- Configuration changes：
- Deployment order dependencies:
- Monitoring/Alerting additions:
### Current-State Comparison (from repo-context.md, **required**)
> The Planner must annotate each item against the `repo-context.md` produced in the RECON phase. The SA review will verify it.
| Decision | Existing item (repo-context section) | Reuse / Extend / Create new | Rationale |
|------|---------------------------|---------------------|------|
|      |                           |                     |      |
**Conflict points** (naming / schema / duplicate config switch names, etc.):
-

---
## Implementation Ownership and Parallel Waves
> This table is frozen before G1. Fast/Full dispatches implementation units for the same Wave and different Repositories in parallel; the same Repository must be placed in different Waves and serialized. When the interface contract is already fixed in this spec, frontend and backend should not be serialized merely because of their call relationship. `Allowed paths` uses repository-relative paths, which may be separated by `<br>`; absolute paths and `..` are prohibited.
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-backend | M1 | backend | AC-001, AC-002 | backend-java | src/main/java/example/** | - | module build + unit | 1 |
| IMP-web | M1 | web | AC-001, AC-003 | web | src/features/example/** | - | typecheck + unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->
Rules:

1. Every AC is covered by at least one Assignment; each Assignment may write to only one assigned Repository.
2. The same Repository must not appear twice in the same Wave; shared worktrees, lockfiles, formatters, codegen, or build directories must be serialized.
3. `Depends on` may only reference an earlier Wave in the same Sprint; when there is no real code-generation dependency, do not artificially serialize frontend and backend whose interface contracts are already frozen.
4. Implementation workers are prohibited from writing `dev-plan.md`, `api-doc.md`, `deploy.md`; shared documents are synchronized by a single owner after all implementations join.
5. In Full mode, the AC/Assignment Sprints must run continuously from M1 to MN, with no missing intermediate Sprints; G1 freezes N. Fast/Lite allow only M1.

---
## Acceptance Contract
> **Rule**: Each contract must be testable (with explicit inputs/outputs or observable state); at least 5 contracts; use Given/When/Then or a checklist.
> **Back-reference**: Each test case in test-cases.md must be tagged with `关联契约: AC-xxx`.
> **Evaluator scoring basis**: acceptance.md is scored item by item against this table.
| AC-ID | 模块 | Given（前置） | When（动作） | Then（预期） | 优先级 | 所属 Sprint |
|-------|------|---------------|--------------|--------------|--------|-------------|
| AC-001 |      |              |              |              | P0     | M1          |
| AC-002 |      |              |              |              | P0     | M1          |
| AC-003 |      |              |              |              | P1     | M1          |
| AC-004 |      |              |              |              | P0     | M2          |
| AC-005 |      |              |              |              | P1     | M2          |

### Non-Functional Contract (Performance / Security / Compatibility)
| AC-ID | 维度 | 指标 | 达成判据 | 所属 Sprint |
|-------|------|------|---------|-------------|
| AC-NF-001 | Performance | P99 response time | ≤ 200ms | M1 |
| AC-NF-002 | Security | SQL injection | All parameterized queries pass scanning | M1 |
| AC-NF-003 | Compatibility | Legacy interface behavior | Existing callers require no changes | M2 |

---

## Sprint Slices
> **Rule**: Slice based on AC dependencies and on what can be delivered independently, not by estimated diff line count or number of commits.
| Sprint | 范围描述 | 覆盖 AC-ID | 预估 diff 行数 | 预估用例数 | 依赖（前置 sprint） |
|--------|---------|-----------|---------------|-----------|---------------------|
| M1     |         | AC-001, AC-002, AC-003, AC-NF-001, AC-NF-002 | ~800  | ~15 | None |
| M2     |         | AC-004, AC-005, AC-NF-003 | ~1200 | ~20 | M1 |
| M3     |         |           |               |           |                     |

### Sprint Definition of Done (DoD)
A sprint is considered complete if and only if:
1. All AC-IDs for the sprint have been implemented and the required local verification has passed; by default, final_only performs unified acceptance scoring after the full-requirements test is released
2. All known blocking defects for the sprint have been fixed with verification evidence; verification that requires test remains in the full-requirements acceptance phase
3. The final `结论: PASS` for this sprint's section in sa-code-review.md
4. The candidate is consistent with the review and verification evidence; verified history is not rewritten based on commit count

---
## Change Log

| Date | Change | Trigger | Affected AC-ID / Sprint | Owner |
|------|---------|---------|----------------------|--------|
| YYYY-MM-DD | Initial version | Planner expands requirements.md | All | Planner |
