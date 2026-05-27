# 演示：用 preset-nexs 跑一个最小需求

这个目录展示如何在一个真实项目里启用 cc-nexs 流水线（preset-nexs）。

## 文件清单

```
examples/using-preset-nexs/
├── cc-nexs.config.yml             # 项目级配置：选 preset、覆盖阈值
└── doc/
    └── 01.demo-feature/           # 一个待开发的需求
        ├── requirements.md        # PM 写业务需求
        ├── spec.md                # Planner 产出
        ├── progress.md            # orchestrator 维护
        ├── ...                    # 其他模板
        └── bugs/                  # QA 发现 bug 时落到这里
```

## 真实使用步骤

```bash
# 1. 软链 preset 到 ~/.claude/plugins/
ln -s /path/cc-nexs/packages/preset-nexs ~/.claude/plugins/cc-nexs

# 2. 进入演示目录
cd examples/using-preset-nexs

# 3. 编辑业务需求
vi doc/01.demo-feature/requirements.md
# (写一段：要开发什么 / 关键场景 / 验收要点)

# 4. 启动流水线
/cc-nexs:run 01

# 自动跑到 SPEC_PENDING_HUMAN 后停下，输出 spec 摘要让你审核
# 5. 审核满意
cat doc/01.demo-feature/spec.md
/cc-nexs:approve-spec 01

# 6. 继续
/cc-nexs:run 01
# 全自动跑到 COMPLETE
```

## 想看对照体验？

试试 preset-minimal（3 角色、英文、单工具）：

```bash
rm ~/.claude/plugins/cc-nexs
ln -s /path/cc-nexs/packages/preset-minimal ~/.claude/plugins/cc-nexs

# 重新跑同一需求，体感会简化（无 SA / Evaluator 分离，无 sprint 切片）
/cc-nexs:run 01
```

切回原 preset 把链接换回去即可。
