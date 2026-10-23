---
slug: <kebab-case-topic>            # Globally unique; matches the filename; ≤ 5 English words
keywords:                            # ≥ 3; Lean Planner grep targets, a hit pulls it into the next requirement
  - <keyword1>
  - <Keyword2>
  - <关键词3>
first_seen: <feature-id>            # ID of the requirement where it was first found
last_updated: YYYY-MM-DD
related_features:                    # All requirements that have matched this solution
  - <feature-id-1>
---
# <topic one sentence matching the slug semantics>

## Symptoms
(Under what scenarios is it triggered; be specific about error signals / behavior / log keywords / observable abnormal symptoms.
Don't write “something will go wrong” — write “seeing X error code / Y log / Z behavior”.)
## Root Cause
(Why it happened; not a surface issue but a deep-seated one.
It may involve: unintuitive framework/library behavior, mismatched upstream/downstream contracts, configuration coupling, concurrency timing, or dependency version pitfalls.)
## Solution
(Concrete steps. Readers can follow this section and get the fix right.
Anti-pattern comparison:
- ❌ <wrong approach> — why it's wrong
- ✅ <正确做法> — why it's right)
## Related Code / Docs (Optional)
- src/.../X.java:42
- docs/...
- External link: ...
## Additional Observations
(Each update appends one paragraph; **do not overwrite** the previous content. Format:)

- YYYY-MM-DD (feature `<id>`): <new observation / additional understanding / boundary conditions / failure case>
