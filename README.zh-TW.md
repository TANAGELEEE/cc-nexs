# cc-nexs

[English](./README.en-US.md) · [繁體中文（台灣）](./README.zh-TW.md)

> 多角色 + 狀態機驅動的 Claude Code / Codex / Pi 開發流程框架。原始碼用 monorepo 維護，釋出產物按各執行時的原生擴充套件機制分發。

## 這是什麼

把開發流程 SOP 拆成兩層：

- **`packages/core/`** —— 通用框架。狀態機引擎、角色註冊、reviewer 工具適配、跨平臺 hooks、i18n、共享 commands。
- **`packages/preset-*/`** —— 專案預設。宣告啟用哪些角色、用什麼工具、做什麼棧檢查、載入什麼模板。

原始碼維護方便（monorepo），分發產物扁平（每個 preset 物化進 `dist/`，自包含可裝），透過 `pnpm build` 把 core 內容物化進每個 preset 的 dist 目錄。Claude Code 與 Codex 使用 dist plugin；Pi 使用根 package manifest、擴充套件、skills 和 package agents，但三邊共用同一份 command SOP。

## 當前預設

| Preset | 適用場景 | 角色 | 工具 | 語言 |
|--------|---------|------|------|------|
| `preset-standard` | 通用多倉專案；具體技術棧由私有 overlay 注入 | 支援 **lean（預設）/ hotfix / fast / full**；Pi 使用 pi-subagents 隔離角色 | 每個 Lean/Hotfix 角色可配置模型與 effort/thinking；公開 preset 不固定模型 ID | 中文 |
| `preset-minimal` | 通用 / 個人專案 / 跨語言起步 | 3 角色（Planner / Developer / Reviewer）| Claude 單工具 + 子代理隔離 | 英文 |

新增預設按 [docs/extending-presets.md](./docs/extending-presets.md) 操作。模式和角色選擇見 `preset-standard` 的 [docs/role-map.md](./packages/preset-standard/docs/role-map.md)。

`preset-standard` 新需求預設 Lean；滿足 low/medium、複用既有能力、無新表結構/基礎設施/破壞性契約的小需求預設走 fast-track：計劃批准後按 worktree/feature branch 並行實現，能本地完成的 build/start/smoke 立即完成；例如 backend-java 無法本地啟動時，記錄結構化 `deferred_to_test` 證據後繼續，不再反覆嘗試。隨後凍結精確 candidate，先合入 test 並觸發 CI/部署，再在部署環境驗收（web 可本地啟動並連線已部署的 test backend），最後做一次集中 Review 並停在 Gateway B。瀏覽器、登入/MFA 與驗收頁面 URL 都只屬於部署後 verification；缺少能力時進入可恢復的 `manual_required`，不會阻塞或回滾 test merge/CI。高風險 Lean 使用 Review-first standard lane，Fast/Full 需顯式指定；沒有 `delivery` 欄位的歷史需求繼續保持舊的逐 Sprint + manual 語義。

顯式 Fast/Full 的多端實現也不再由一個 Fullstack/Tech Lead 序列包辦。G1 會繫結 spec 中的 repository ownership DAG；同一 wave、不同 assigned worktree 的 backend/web worker 在 Claude Code、Codex、Pi 上同時啟動，整批共享凍結的模型路由。全部 join 後才進行每倉聚合驗證、唯一共享文件同步和每倉一個 candidate；同一 repository 始終序列，避免 lockfile、codegen、formatter 與構建目錄互相汙染。

Lean/Hotfix 模型採用風險驅動路由。有效優先順序是：公開 preset < 私有 overlay < 專案 `cc-nexs.config.yml.models` < feature profiles/routing < 命中的 routing rules < feature `models.roles` 顯式覆蓋。新 feature 模板不再生成 `models.roles`，因此日常專案配置會真正生效。

`risk_tier:auto` 時，Lean 從 Gateway A 繫結的計劃風險取值，Hotfix 從繫結的 P0/P1/P2/P3 severity 推斷。歷史 Gateway A 缺少風險欄位時，只從 hash 完全匹配的已批准 scope 派生；無法證明則按 `high` 保守升檔，絕不靜默回落 `medium`。公開規則自動把 Lean `high|critical` 的 Planner/Reviewer、Hotfix P0/P1 的 Reviewer 切到 `escalated`。公開 `escalated` 仍是 provider-neutral 的 `inherit + xhigh`；專案要切換實際高能力模型，應在私有配置覆蓋同名 profile：

```yaml
models:
  profiles:
    daily-development:
      claude:
        model: inherit
        effort: medium
      codex:
        model: inherit
        effort: medium
      pi:
        model: inherit
        effort: medium
    daily-review:
      claude:
        model: inherit
        effort: high
      codex:
        model: inherit
        effort: high
      pi:
        model: inherit
        effort: high
        fallback_models: []
    escalated:
      claude:
        model: your-strong-claude-model
        effort: xhigh
      codex:
        model: your-strong-codex-model
        effort: xhigh
      pi:
        model: your-provider/strong-model
        thinking: xhigh
  roles:
    lean-developer: daily-development
    lean-reviewer: daily-review
```

專案可以繼續分別給 Planner、Developer、Reviewer、Verifier 配置低預算日常 profile；只有命中風險規則的角色升檔。feature 顯式 profile 仍是最終人工決定，`models.routing.enabled: false` 可顯式關閉自動路由。三端始終使用獨立 Reviewer session。

配置具體模型前必須以宿主的原生子代理 override 能力為準；模型出現在頂層目錄中，不等於當前 native-agent dispatch 一定允許它。Fast/Full 仍會解析 `repo-scout/planner/tech-lead/sa/qa/evaluator/fullstack/reviewer/verifier`，主要執行這兩種模式的專案也應顯式對映這些角色，否則它們會繼承宿主模型。

注意：`models.routing.rules` 是有順序的陣列，後匹配規則覆蓋先匹配規則；overlay/project/feature 一旦宣告該陣列，會整體替換低層陣列，而不是按 `id` 追加。僅覆蓋 profiles/roles 時不要重複宣告 rules。

舊 Lean/Hotfix feature 已生成的預設 `models.roles` 會遮蔽專案配置，先安全預覽再遷移：

```text
/cc-nexs:migrate-feature-config <id> --dry-run
/cc-nexs:migrate-feature-config <id>
/cc-nexs:migrate-feature-config <id> --dry-run --bind-plan-risk
/cc-nexs:migrate-feature-config <id> --bind-plan-risk
```

遷移只移除結構化精確匹配舊模板的完整預設對映；任何自定義 role/profile/routing 都會保留。`--bind-plan-risk` 是獨立 opt-in：僅將 hash 驗證透過的 concrete risk 回填舊 Gateway A，並記錄 migration event；stale/缺失/歧義 scope 會拒絕寫入。

Claude Code 的 Lean 四角色全部使用獨立 Claude 子代理；Codex 的 Lean 四角色全部使用獨立 native agent；Pi 使用 `pi-subagents@0.35.1` 的 `subagent`，將 thinking 編碼為任務的 `provider/model:thinking` selector，無需在 `.pi/settings.json` 再維護一份角色對映。Pi 的 `fallback_models` 只重試失敗任務，不重複執行已成功的並行 sibling。

## 目錄結構

```
cc-nexs/
├── packages/                       原始碼（monorepo）
│   ├── core/                       通用框架
│   │   ├── commands/               共享 orchestrator commands（run/approve-spec/status/init）
│   │   ├── lib/                    Node.js 框架程式碼
│   │   ├── hooks/                  跨平臺 .mjs hooks
│   │   ├── schemas/                preset / workspace / overlay / progress.json v2 Schema
│   │   └── i18n/{zh-CN,en-US}.json
│   │
│   ├── preset-standard/            五方異構預設（中文）
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── preset.yml
│   │   ├── agents/ × 5             五方角色身份
│   │   ├── commands/ × 6           preset 自有階段命令（planner/sa/dev/qa/evaluator/hotfix）
│   │   ├── skills/ × 4
│   │   ├── docs/                   預設架構 / workflow / role-map
│   │   ├── templates/              11 份中文模板
│   │   └── hooks/hooks.json        hook 註冊（實現指令碼來自 core）
│   │
│   └── preset-minimal/             3 角色通用預設（英文）
│       ├── .claude-plugin/plugin.json
│       ├── .codex-plugin/plugin.json
│       ├── preset.yml
│       ├── agents/ × 3
│       ├── commands/ × 3
│       ├── templates/
│       ├── i18n/en-US/strings.json
│       └── hooks/hooks.json
│
├── scripts/
│   └── build.mjs                   build 指令碼：core 物化進每個 preset
│
├── .claude-plugin/                 Claude Code marketplace
│   └── marketplace.json
│
├── .agents/plugins/                Codex marketplace
│   └── marketplace.json
│
├── dist/                           build 產物（**commit 進 git** 讓 GitHub / Codex marketplace 能直接裝 plugin）
│   ├── preset-standard/            扁平自包含 plugin
│   │   ├── .claude-plugin/plugin.json
│   │   ├── .codex-plugin/plugin.json
│   │   ├── commands/ × 10          preset 6 + core 4 物化合並
│   │   ├── agents/ × 5
│   │   ├── skills/                 Claude Code 原 skills（不放 Codex mirror，避免汙染 Claude 側）
│   │   ├── codex-skills/           Codex command mirror skills
│   │   ├── docs/
│   │   ├── templates/
│   │   ├── hooks/                  *.mjs（來自 core）+ hooks.json（來自 preset）
│   │   ├── lib/                    core/lib 物化
│   │   ├── schemas/                core/schemas 物化
│   │   └── i18n/                   core + preset 合併
│   └── preset-minimal/             同上結構
│
├── examples/
│   └── using-preset-standard/      演示專案
│
├── docs/
│   ├── architecture.md             core × preset 關係
│   ├── codex-plugin.md             Codex plugin 安裝與復刻說明
│   ├── pi-plugin.md                Pi P2 安裝、模型隔離與支援邊界
│   └── extending-presets.md        寫新預設指南
├── pi/
│   ├── extensions/cc-nexs.ts       Pi slash command + child role guard
│   ├── skills/                      lean + fast + full + hotfix P2 command mirrors
│   └── agents/                      pi-subagents package roles
│
├── pnpm-workspace.yaml
└── package.json
```

## 構建

```bash
pnpm build             # 構建全部 preset
pnpm build:codex       # 同 build；顯式用於 Codex plugin 產物重新整理
pnpm build:standard    # 僅構建 preset-standard
pnpm build:minimal     # 僅構建 preset-minimal
pnpm validate:claude   # 校驗 Claude Code marketplace / install 指令碼入口 / skills 隔離
pnpm validate:codex    # 校驗 Codex manifest / marketplace / command mirror skills
pnpm validate:pi       # 校驗 Pi package / P2 skills / package agents / 無固定模型
pnpm validate:sop      # 校驗 lean / full / fast / hotfix 的關鍵文件落點和 mirror 契約
pnpm smoke:claude-install # 用臨時 HOME 煙測 Claude Code 本地安裝形態，不碰真實 ~/.claude
pnpm smoke:pi-install  # 用臨時 PI_CODING_AGENT_DIR 驗證本地 Pi package 註冊
pnpm validate:plugins  # 同時校驗 Claude Code + Codex 兩邊 plugin 產物與安裝形態
pnpm clean             # 刪 dist
```

build 做什麼：

1. preset 自有 `commands / agents / skills / docs / templates / preset.yml / i18n` 拷進 `dist/<preset>/`
2. `core/commands` `core/hooks` 物化進 `dist/<preset>/`，**preset 同名檔案優先**（不被覆蓋）
3. `core/lib` `core/schemas` `core/i18n` 拷進 `dist/<preset>/`
4. 文字類檔案做路徑 rewrite：`core/lib/X` → `lib/X`、`_core/X` → `X`、`../core/X` → `X`
5. `.claude-plugin/marketplace.json` 自動生成，列出所有 preset 作為 Claude Code plugin
6. `.agents/plugins/marketplace.json` 自動生成，列出所有 preset 作為 Codex plugin
7. 為 Codex 生成 `codex-skills/`：每個 `commands/*.md` 都會生成一個 `$cc-nexs-*` mirror skill，仍回指原 command 文件；原 `skills/` 不寫入 Codex mirror，避免影響 Claude Code plugin
8. 為 Pi 生成 lean + fast + full + hotfix command skills 和 package-qualified role agents；Fast/Full 同 wave 多倉透過一次 `subagent({ tasks, concurrency, async: true, worktree: false, context: "fresh" })` 啟動，再用 `subagent_wait` 匯合

dist 是真正的 plugin 載體。Claude Code 讀取 `.claude-plugin/marketplace.json`；Codex 讀取 `.agents/plugins/marketplace.json`。兩者都指向同一批 `dist/preset-*`。三端入口均為僅顯式觸發：普通自然語言開發請求不會自動啟用 cc-nexs。

## 安裝

### Codex 本地安裝

```bash
cd /path/to/cc-nexs
pnpm install:local:codex
```

這會執行：

1. `pnpm build`
2. `pnpm validate:plugins`
3. 把 `dist/preset-*` 同步到 `~/.codex/plugins/cache/cc-nexs/`
4. `codex plugin marketplace add /path/to/cc-nexs`
5. 在 `~/.codex/config.toml` 中預設啟用 `cc-nexs@cc-nexs`，關閉 `cc-nexs-minimal@cc-nexs`，避免重複 skill 候選

然後重啟 Codex 或開新 thread。可以在 `/plugins` 中檢查 `cc-nexs@cc-nexs` 是否已啟用；hooks 第一次執行前需要在 `/hooks` 中 review + trust。

Codex 使用顯式 skill 入口；每個 mirror skill 的 `agents/openai.yaml` 都設定 `policy.allow_implicit_invocation: false`，因此不會進入預設模型上下文。`/cc-nexs:*` 僅作為相容文字提示，不是可執行 shell/slash command：

```text
$cc-nexs-init "需求描述"             # 預設 lean
$cc-nexs-plan 01
$cc-nexs-approve-plan 01
$cc-nexs-init "複雜需求" --mode=full # 只有顯式指定才走 full
$cc-nexs-run 01
$cc-nexs-approve-release 01
$cc-nexs-release-base 01
$cc-nexs-release-test 01
$cc-nexs-approve-deploy 01
$cc-nexs-hotfix "現象描述" --repos=api  # 自動建立 hotfix 分支與 BUG 文件，不佔需求號
```

Codex 側實現方式是 command mirror skills。`$cc-nexs-run` 讀取 `commands/run.md` 作為唯一事實來源，所以 lean / full / fast / hotfix 的文件寫入位置和狀態機邏輯不會分叉。審批 skill 會呼叫確定性的 `cc-nexs` 控制程式，不會手工修改 progress。詳見 [docs/codex-plugin.md](./docs/codex-plugin.md)。

### Claude Code 本地開發（一條命令）

```bash
cd /path/to/cc-nexs
pnpm install:local              # 等價於：build + 拷到 ~/.claude/plugins/cache/

# 切換到 minimal preset
pnpm install:local:minimal
```

`install:local` 做的事：

1. 跑 `build` 產出 `dist/preset-<name>/`
2. **真實複製**到 `~/.claude/plugins/cache/cc-nexs/cc-nexs/<version>/`（不軟鏈——Claude Code 啟動期會清理非標準 cache）
3. 同步 `~/.claude/plugins/installed_plugins.json` 後設資料
4. 校驗 `~/.claude/settings.json` 已啟用 plugin

完成後重啟 Claude Code 即可生效。後續改原始碼再跑一次 `pnpm install:local` 即可。Claude Code 的 commands 與原生 skills 都設定 `disable-model-invocation: true`；只會在使用者輸入 `/cc-nexs:*`、`/cc-nexs-minimal:*` 或顯式 skill 命令時執行。角色 agent 的路由描述也限定為只接受已顯式啟動的 cc-nexs 父流程排程。

### Pi P2 安裝

Pi 當前為實驗性 P2 支援，承諾 `preset-standard` lean、fast、full 和 hotfix 流程。公開 GitHub 安裝：

```bash
pi install npm:pi-subagents@0.35.1
# macOS 首選 provider（安裝後開啟 ego lite 完成一次首次引導）
npx skills add citrolabs/ego-lite
# Windows 或 ego lite 不可用時的 fallback
pi install git:github.com/injaneity/pi-computer-use@v0.4.3
pi install git:github.com/<github-owner>/cc-nexs
```

computer-use fallback 必須在專案 `.pi/computer-use.json`（或全域性配置）啟用 `{"browser_use":true,"headless":true}`。這裡的 headless 表示禁止搶佔前臺焦點、物理鍵鼠和游標；Windows 仍需要可互動桌面會話與已開啟的瀏覽器視窗。

從本倉庫開發或除錯時使用本地安裝：

```bash
pnpm install
pnpm install:local:pi
```

Pi 不呼叫 Codex CLI。生成的 Pi skills 設定 `disable-model-invocation: true`，從系統提示中隱藏，只能透過 `/cc-nexs:*` 或 `/skill:cc-nexs-*` 顯式呼叫。Lean 各角色從 cc-nexs profile 解析 `model`、`thinking` 和 `fallback_models`；父代理在 `subagent` 任務的 `model` selector 中編碼 thinking，Reviewer 可用不同模型，也可用相同模型但更高 thinking。主模型不可用時只按 fallback 順序重試失敗任務。`.pi/settings.json` 只保留 Pi 認證與 `enabledModels` 範圍。Pi 在 test merge/CI 完成後才選擇瀏覽器 provider：優先 ego lite，不可用時選擇獨立的 computer-use Verifier，並要求有效配置為 `browser_use: true`、`headless: true`。同一 child 不會同時獲得兩套 provider；兩者都不可用或登入態失效時，已部署 candidate 保持不變，verification 進入可恢復的 `manual_required`。詳見 [Pi P2 支援](./docs/pi-plugin.md)。

Claude Code 自動環境驗收使用 `chrome-devtools-mcp`；Codex 複用當前已登入的 in-app/Chrome 會話。三端都只在部署後訪問 `release.test.allowed_hosts`，瀏覽器、登入/MFA 或驗收 URL 缺失只會產生 `manual_required`，不會阻止 test merge/CI。不得從專案 memory、Markdown 或 Git 讀取明文賬號密碼，必要登入只允許透過 opaque `credential_ref` 對接外部 secret provider。

### Claude Code 從 GitHub 裝（其他機器 / 協作者）

```bash
/plugin marketplace add <github-owner>/cc-nexs
/plugin install cc-nexs@cc-nexs                 # 五方異構（preset-standard）
/plugin install cc-nexs-minimal@cc-nexs         # 3 角色（preset-minimal）
```

`/plugin marketplace add <github-owner>/cc-nexs` 會拉倉庫根目錄的 `.claude-plugin/marketplace.json`；它的 `plugins[].source` 指向 `./dist/preset-*`——所以釋出倉庫必須包含經過可重複構建校驗的 `dist/`。

## 日常命令

Claude Code、Codex 和 Pi 共享同一命令語義，但使用各執行時的原生入口。三邊都以 `commands/*.md` 為流程事實來源，審批狀態統一由 `cc-nexs` 核心命令寫入；未出現下表入口時，三端都不得僅憑自然語言自動進入 cc-nexs。

“僅顯式觸發”只約束入口，不改變流程內部自動推進：顯式執行 `run` 後，Orchestrator 會繼續執行到既有人工門禁、明確阻塞或能力不足為止，不要求使用者逐步呼叫 `execute`、`lean-review`、`verify-local` 等內部階段命令。

| 執行時 | 推薦入口 |
| --- | --- |
| Claude Code | `/cc-nexs:plan 01`、`/cc-nexs:run 01`、`/cc-nexs:approve-release 01` |
| Codex Desktop / CLI | `$cc-nexs-plan 01`、`$cc-nexs-run 01`、`$cc-nexs-approve-release 01` |
| Pi | `/cc-nexs:plan 01`、`/cc-nexs:run 01`、`/cc-nexs:approve-release 01` |
| 普通終端 | `cc-nexs approve-plan 01`、`cc-nexs verify-local 01`、`cc-nexs approve-release 01` |

```bash
/cc-nexs:init "需求描述"          # 預設 lean；每倉獨立 worktree + feature/<id>-<slug>
/cc-nexs:plan [編號]               # 生成 requirements/plan 與臨時 HTML，停 Gateway A
/cc-nexs:approve-plan [編號]       # 批准 plan 雜湊
/cc-nexs:run [編號]                # 實現 → 能做的本地驗證 → test/CI → 環境驗收 → 一次集中 Review
/cc-nexs:approve-release [編號]    # Gateway B，批准精確 tested fingerprint
/cc-nexs:request-release-changes [編號] --type=... --feedback="..."  # Gateway B 提意見並安全迴流
/cc-nexs:release-base [編號]       # 批准後合併配置 base，docs 最後歸檔
/cc-nexs:run [編號] --no-auto-test-release # 本次顯式交給外部 test 釋出；Lean/Hotfix 不可用 G2 代替 release attempt
/cc-nexs:release-test [編號]      # 完整 candidate 確定性合入 test + 調 release driver
/cc-nexs:approve-spec [編號]      # 人工放行 spec
/cc-nexs:status [編號]            # 只讀看狀態
/cc-nexs:build [--phase=...]      # 按 git diff 自動選 build/test 命令並跑

/cc-nexs:hotfix "現象描述" --repos=api  # hotfix/<key> + BUG 文件，不佔需求號
/cc-nexs:hotfix [bug-key]         # 恢復：本地驗證、獨立 Review、test、Gateway B
/cc-nexs:revise-hotfix [bug-key] --reason "原因" --authorization-evidence "已有授權" # 原任務重綁
```

G1/G2 是狀態機暫停點，不是全域性工具鎖。等待人工確認時，父會話仍可執行使用者授權的 Git、SQL、SSH、部署、診斷和文件操作；只有 cc-nexs 的下一角色不會被派發。

### 多模組專案按目錄自動選 build 命令（v0.3 起）

混合棧倉庫（如 backend Java + 前端 Next.js）經常一個倉庫多套構建命令。`/cc-nexs:build` 會讀 `cc-nexs.config.yml` 的 `paths_override.modules`，用 `git diff` 決定本次需求改了哪些 module，**只跑命中的 module 的命令**：

```yaml
paths_override:
  diff_base: main
  build_cmd: ""      # 頂層 fallback（doc-only 改動時跑）
  test_cmd:  ""

  modules:
    - name: backend
      match: ["api-service/**"]
      build_cmd: "cd api-service && mvn -q compile"
      test_cmd:  "cd api-service && mvn -q test"
    - name: web
      match: ["web/**"]
      build_cmd: "cd web && pnpm build"
      test_cmd:  "cd web && pnpm test"
```

從任一需求 worktree 執行時會向上發現 workspace 根配置，也可顯式傳 `--config-root`。跨模組改動（同時改了 backend + web）預設最多並行 2 個獨立模組；用 `depends_on` 宣告順序約束，命中下游模組時會自動補齊依賴閉包。成功結果繫結完整 Git candidate fingerprint 並快取在倉庫外，HEAD/base/diff/untracked/命令任一變化都會重新執行。`workflow.local_verify.reuse_passed=true` 還會複用同一 candidate 的本地證據；Lean 未配置 driver 時可直接繫結 plan-approved 命令的 command/exit/proof；Hotfix 同樣支援繫結範圍內的命令證據，必須覆蓋凍結矩陣，且不允許延期到 test。所有 Hotfix 級別（包括 P3）均需獨立 Review。

### 多倉 Worktree 與 Git Custodian（v0.4）

在 workspace 根目錄配置 `.cc-nexs/workspace.yml`。普通 Lean/Fast/Full 的 `/cc-nexs:init` 首先向 docs 倉遠端 base fast-forward push 一個只含 README 和 reservation marker 的最小佔號提交，讓未使用 cc-nexs 的開發者也能立即看到編號；併發衝突會重新 fetch、換號重試。佔號成功後再以各倉最新 `origin/<base_branch>` 建立 `.worktrees/<id>-<slug>/<repo-id>/`；不會使用主 checkout 當前所在的 `test`/`master`，也不會把 feature 的 upstream 錯綁到 base 分支。

```
/cc-nexs:init "需求 A"     → 建 .worktrees/01-feat-a/{docs,api,web}/
/cc-nexs:run 01            → 從 workspace 根或任一已分配 worktree 推進

# 同時另開一個需求
cd <workspace-root>
/cc-nexs:init "需求 B"     → 建另一組多倉 worktree
```

Hotfix 直接建立 `hotfix/<key>` 和 `.worktrees/<key>/<repo>/`。有關聯需求時將 BUG 寫入其 `doc/<id>.<slug>/bugs/BUG-<key>.md`；無關聯時寫入 docs 倉的 `hotfix/<key>/BUG-001.md`。機器狀態在 workspace `.cc-nexs/hotfixes/<key>/`，透過 `progress.hotfix_document` 定位 BUG，不釋出佔位提交。舊 `hotfix.md` 任務仍可恢復。同一故障的授權修訂用 `revise-hotfix` 在原分支重綁；契約擴充套件加 `--promote-lean`，在原 BUG 旁建立 Lean 文件並透過 Gateway A。

已真實部署到 test 但環境能力阻塞驗收時，使用者可以在現有 Gateway B 明確授權 `approve-release --test-exception`。控制器要求同一 candidate 的本地驗證和 Review 透過，以及授權、環境和回滾證據；保留 test 未透過的事實，僅授權配置 base 整合，不預設授權生產部署。

角色只寫職責內檔案，不執行 Git mutation。唯一的直接 docs-base 寫入是普通需求的 Custodian 第一階段佔號，且只能新建一個此前不存在的需求目錄。普通提交不執行 `git pull`。使用者明確授權合併到 master 後，由 Custodian fetch 並把最新 base 合入 feature，程式碼倉先合併、all-docs 第二階段歸檔最後合併；同一釋出任務隨後完整刪除遠端 feature、本地 feature、worktree 和 candidate ref。只有使用者明確要求保留遠端分支時才例外。

具體階段命令（角色單步呼叫）由各 preset 決定，詳見各 preset 的 README。

## 設計原則

1. **事件狀態機** —— `progress.json` v2 是帶 revision 的權威事件記錄，`progress.md` 僅作人類可讀檢視
2. **兩類門禁語義明確** —— Lean 固定 Gateway A（計劃）與 Gateway B（tested candidate）；部署後驗收能力不足進入可恢復 `manual_required`，不再把瀏覽器問題當成 test 交付前的 G2
3. **三檔熔斷** —— review 反覆打回、修復反覆失敗、驗收反覆未過分別升級到不同狀態
4. **角色邊界硬隔離** —— hooks 透過 `CC_NEXS_ROLE` 環境變數攔截越權操作
5. **預設可插拔** —— 新專案棧寫新 preset，不動 core
6. **多執行時同源** —— Claude Code、Codex、Pi 共享 command SOP；執行時只適配角色排程、模型解析和許可權攔截
7. **原始碼 / 分發分離** —— 原始碼用 monorepo 維護清晰，分發用扁平 plugin 相容 Claude Code 與 Codex 載入機制

## 狀態

當前版本將開發 Sprint 與需求交付分離：Lean fast-track 在本地不可驗證項留存 `deferred_to_test` 後，優先完成確定性 test merge/CI；跨端瀏覽器驗證只發生在部署後，能力不足可人工恢復，不回滾已經完成的交付。

## License

MIT

## 多語言與模板覆寫

執行時字串支援 `en-US`、`zh-CN` 與 `zh-TW`。將專案的 `language` 設為目標語系；preset 覆寫放在 `i18n/<locale>/strings.json`。模板可放在 `templates/<locale>/`，並以 `CC_NEXS_LOCALE` 選用；缺少的檔案會回退到預設模板，不改變既有流程契約。
