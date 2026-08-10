---
description: "Read-only status snapshot of the active feature pipeline."
disable-model-invocation: true
allowed-tools: "Read, Bash, Glob"
argument-hint: "[feature_id]"
---

# /cc-nexs:status

## Steps

1. Resolve workspace docs assignment and locate authoritative progress.json v2 plus its progress.md mirror
2. Read mode/state/revision/gates/counters/delivery from progress.json; require config.json.mode to agree and report config_version/risk_tier migration status, including `plan_binding_status=bound|derived|unknown` for approved Lean work
3. Use `readProgressV2()` (or `readProgress(progress.md)` compatibility delegation)
4. Print (Lean 显示 plan/local review/test/base；Hotfix 显示 scope/severity/local/review/test/base；fast 显示 BUILD/TEST/ACCEPT)：

```
═══════════════════════════════════════════════════════════════
📊 cc-nexs Pipeline Status
═══════════════════════════════════════════════════════════════

Feature:    <id> <slug>
Branch:     <git branch --show-current>
Repositories: <repo id → branch/worktree/candidate>
Mode:       <lean | hotfix | full | fast>
Revision:   <event revision>
Updated at: <updated_at>
Delivery:   <final_only|per_sprint> / test <auto_if_ready|manual|disabled>
Risk:       <effective tier / source / all signals>
Models:     <next role → matched rule / profile / model / effort / feature override>

🚦 Current state: <state> — <i18n description>

📈 Progress
   full: Sprint <current>/<total>  + 列出 M1, M2, ... 状态
   fast: 阶段 BUILD / TEST / ACCEPT 各自 done/in_progress/pending
   lean: PLAN / IMPLEMENT / LOCAL VERIFY / REVIEW / TEST / BASE MERGE
   hotfix: SCOPE / IMPLEMENT / LOCAL VERIFY / REVIEW-or-P3-SKIP / TEST / GATEWAY B / BASE MERGE

🔢 Counters
   Review revisions:  <n>/<threshold>
   Fix per bug:       <map>
   Evaluator rejects: <n>/<threshold>

⏸️ Human gate
   Plan:    <approved + binding | not yet>
   Release: <approved + tested fingerprint | not yet>
   Legacy G1/G2: <approval summary>

📜 Recent history (last 5)
   <history tail>

🚀 Test release
   Status: <idle|running|succeeded|failed|deployed_needs_manual_verification|verified>
   Latest: <attempt id / source fingerprint / integrated repos / pipeline / deployment / environment_revision>
   Verification: <passed|blocked|not recorded + evidence refs>

🧪 Lean / Hotfix evidence
   Local:  <status / candidate fingerprint / evidence refs>
   Review: <status / reviewed commits / blocking findings / closure count / Gateway B delta count>
   Changes: <current Gateway B request + type / recent requests>
   Base:   <status / integrations>
   Hotfix: <severity / related feature / scope hash / review required>

🚧 Human required
   <list, or "none">

🌿 Files
   requirements.md:   <exist? lines>
   plan.md:           <approval scope / latest Review + Test conclusions>
   hotfix.md:         <bound scope / Review / test / rollback evidence>
   spec.md:           <exist? lines>
   sa-review.md:      <last conclusion>
   sa-code-review.md: <last conclusion>
   test-cases.md:     <AC coverage>
   test-report.md:    <last conclusion>
   acceptance.md:     <last result>
   bugs/:             <OPEN x / FIXED y / VERIFIED z>

💡 Suggested next step
   <derived from current_state + mode>
═══════════════════════════════════════════════════════════════
```

Strictly read-only. To advance, run `/cc-nexs:run`.
