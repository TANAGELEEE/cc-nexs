---
description: Read-only status snapshot of the active feature pipeline.
allowed-tools: Read, Bash, Glob
argument-hint: [feature_id]
---

# /cc-nexs:status

## Steps

1. Resolve workspace docs assignment and locate authoritative progress.json v2 plus its progress.md mirror
2. Read mode/state/revision/gates/counters/delivery from progress.json; require config.json.mode to agree
3. Use `readProgressV2()` (or `readProgress(progress.md)` compatibility delegation)
4. Print (Sprint progress 段在 fast 模式被替换为 BUILD/TEST/ACCEPT 阶段进度)：

```
═══════════════════════════════════════════════════════════════
📊 cc-nexs Pipeline Status
═══════════════════════════════════════════════════════════════

Feature:    <id> <slug>
Branch:     <git branch --show-current>
Repositories: <repo id → branch/worktree/candidate>
Mode:       <full | fast>
Revision:   <event revision>
Updated at: <updated_at>
Delivery:   <final_only|per_sprint> / test <auto_if_ready|manual|disabled>

🚦 Current state: <state> — <i18n description>

📈 Progress
   full: Sprint <current>/<total>  + 列出 M1, M2, ... 状态
   fast: 阶段 BUILD / TEST / ACCEPT 各自 done/in_progress/pending

🔢 Counters
   Review revisions:  <n>/<threshold>
   Fix per bug:       <map>
   Evaluator rejects: <n>/<threshold>

⏸️ Human gate
   Approved at: <ts | "not yet">
   Approver:    <name | "—">

📜 Recent history (last 5)
   <history tail>

🚀 Test release
   Status: <idle|running|succeeded|failed|deployed_needs_manual_verification|verified>
   Latest: <attempt id / source fingerprint / integrated repos / pipeline / deployment / environment_revision>
   Verification: <passed|blocked|not recorded + evidence refs>

🚧 Human required
   <list, or "none">

🌿 Files
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
