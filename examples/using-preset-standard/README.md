# 演示：用 preset-standard 跑一个最小 Lean 需求

这个目录是一个 Lean 示例需求（`/api/health` 健康检查）。流程：`init -> plan（含独立计划审核）-> approve-plan -> run -> approve-release`。

## 文件清单

```
examples/using-preset-standard/
├── cc-nexs.config.yml             # 项目级配置：选 preset、覆盖阈值
└── doc/
    └── 01.demo-feature/           # 一个待开发的需求
        ├── requirements.md        # 业务需求与 AC 表（人工维护）
        ├── plan.md                # Planner 产出；计划审核、Review、Test 证据也写在这里
        ├── config.json            # mode=lean
        └── progress.json / .md    # orchestrator 维护
```

## 真实使用步骤

```bash
# 1. 安装插件（见仓库根目录 README）后进入演示目录
cd examples/using-preset-standard

# 2. 补全业务需求；每条验收标准写成 AC-xxx 表格行
vi doc/01.demo-feature/requirements.md

# 3. 生成计划：Planner 写 plan.md，独立 Plan Reviewer 审核，停在 Gateway A
/cc-nexs:plan 01

# 4. 审核计划与计划审核结论后批准
/cc-nexs:approve-plan 01

# 5. 实现、本地验证、test 交付与验收、一次集中 Review，停在 Gateway B
/cc-nexs:run 01

# 6. 批准合并到 base
/cc-nexs:approve-release 01
```
