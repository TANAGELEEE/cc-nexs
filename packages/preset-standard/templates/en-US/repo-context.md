# Repo Context — {id}.{feature-slug}
> **Owner**: Repo Scout (independent Claude session)
> **Purpose**: Condense the current state that the Planner cannot see (existing similar configurations / Services / pages / APIs / data models) into a factual inventory, which serves as the baseline for comparing the Planner's spec against the current state.
> **Iron rule**: This file is a **factual inventory**, not a **proposal or recommendation**. Every hit must include a repo-relative path + line number.
> **Lifecycle**: Produced during the first RECON phase; if more than 7 days / 50 commits have passed since the last output, it is recommended to re-run `/cc-nexs:recon` for an incremental update.

---
## 1. Domain Keywords
> The domain glossary extracted from requirements.md, which is the input for subsequent grep. Each entry is annotated with its purpose.
| Keyword | Type | Purpose / Source |
|--------|------|-------------|
|        | Entity Name |          |
|        | Table name prefix |        |
|        | API path segment |     |
|        | Page routing |       |
|        | Business Verb |       |

---

## 2. Related Config / Data Tables
> Includes existing tables defined in SQL DDL / Liquibase / Flyway / `*Mapper.xml`. For each one, give a "Reuse / Extend / Must Create New" assessment.
| Table name | Path:Line number | Key fields | Purpose | Reuse decision | Reason |
|------|----------|---------|------|----------|------|
|      |          |         |      |          |      |
If there is absolutely no similar item, state explicitly: `无同类（已 grep <关键词清单>，无命中）`.

---
## 3. Related Services / Mappers / Repositories
> Service layer + data access layer. List method signatures first so the Planner can judge directly whether they can be injected and reused.
| Class Name | Path:Line | Key Method Signature | Reuse Decision | Reason |
|------|----------|-------------|----------|------|
|      |          |             |          |      |

---

## 4. Related Controllers / APIs
> Controller / Resource / Handler layers + registered HTTP paths.
| HTTP Method | Path | Class Name:Line Number | Purpose | Reuse Decision | Rationale |
|-----------|------|----------|------|----------|------|
|           |      |          |      |          |      |

---

## 5. Related Pages / Components / Routes
> The existing views, components, and route table entries under the frontend web/src.
| Path | File:Line | Purpose | Reuse Assessment | Rationale |
|------|----------|------|----------|------|
|      |          |      |          |      |

---

## 6. Related DTO / VO / Req / Resp
> Input/output parameter classes. This is where naming convention conflicts are most likely to arise.
| Class Name | Path:Line Number | Field Highlights | Reuse Decision | Rationale |
|------|----------|---------|----------|------|
|      |          |         |          |      |

---

## 7. Existing Config Flags / Environment Variables
> Existing feature flags / `application*.yml` configuration entries / startup parameters, so that when the Planner designs a new switch, it does not duplicate an existing switch's name or misalign its meaning.
| Config key | Path:Line number | Current value / Default | Purpose | Relationship to this requirement |
|----------|----------|--------------|------|-------------|
|          |          |              |      |             |

---

## 7.5 Project-Level Requirements (from CLAUDE.md / AGENTS.md)
> Mandatory conventions that Repo Scout has extracted from the project root `AGENTS.md` (preferred) / `CLAUDE.md` (fallback) that are **actually relevant to this requirement**. The Planner must follow these conventions when drafting the spec; any violation will be rejected by the SA.
> Filtering rule: extract only the conventions actually relevant to this requirement; better to omit than to over-include.
| Convention | Source:line number | Relationship to this requirement / Landing point |
|------|----------|-------------------------|
|      |          |                         |
If neither AGENTS.md nor CLAUDE.md exists, write: `无项目级约定文件`。
If both exist and their contents conflict, excerpt as per AGENTS.md and flag the contradiction in ## 8 Risk Notice.

---
## 7.6 Relevant Lessons (from docs/solutions/)
> Repo Scout scans `docs/solutions/*.md` using this request's keywords and excerpts the entries that match `keywords` here. The next similar request automatically draws in previously accumulated knowledge—this is cc-nexs compounding.
| Solution slug | Topic | Relevance | Applicable Points |
|--------------|-------|---------|---------|
|              |       |         |         |
If `docs/solutions/` does not exist or has no matches at all, write: `No prior lessons matched (grepped <关键词清单> against frontmatter.keywords, no intersection)`.

---
## 8. Risk Notes (at least 2)
> A heads-up for the Planner to help it avoid pitfalls. Common patterns:

- **Naming conflict**: The name proposed for this requirement, `customer_tag`, semantically overlaps with the existing `customer_label` (src/.../LabelEntity.java:18); pick one or merge them.
- **Schema evolution pitfall**: We plan to add a field `xxx`, but table `yyy` is already inner-joined in multiple places; adding the field requires regression-testing N queries.
- **Circular dependency risk**: Service A depends on Service B, and the new requirement would make B call A in turn; this requires extracting an abstraction.
- **Config flag exists but is not enabled**: `feature.xxx.enabled` is already in the configuration but defaults to false; should this requirement reuse this flag?
- **Missing test fixtures**: The relevant domain's `*Test.java` files have no existing setUp, so newly added cases need fixtures written from scratch.

Replace the examples above with the ones that actually apply to this requirement.

---
## Change Log

| Date | Operation | Trigger | Change Summary |
|------|------|------|---------|
| YYYY-MM-DD | Initial version | RECON phase | Repo Scout full scan |
