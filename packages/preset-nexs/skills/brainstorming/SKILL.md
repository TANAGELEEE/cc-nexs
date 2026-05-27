---
name: brainstorming
description: cc-nexs 需求落地的 Socratic 对话 skill。把 PM 一句话诉求展开成结构化 requirements.md，作为 Planner 产出 spec.md 的输入。**在写任何 spec / 代码 / dev-plan 之前必须先走这一步**。触发词：脑暴、brainstorm、需求展开、需求还很模糊、想做个 X、随便聊聊先、捋清楚需求、把这个想法落地、refine、shape up、design dialogue。
---

# 把模糊想法变成可执行需求

cc-nexs 流水线的输入是 `requirements.md`。它的质量上限决定了 spec.md / 代码 / 验收的天花板。这个 skill 用 Socratic 对话把"PM 一句话诉求"补完成结构化的 requirements.md。

**位置**：`/cc-nexs:init` 之后、`/cc-nexs:run` 之前。

```
init   →   brainstorm   →   run (Planner→spec.md→…)
建目录       本 skill           原 SOP 流水线
写一句话     展 requirements
```

## HARD-GATE

在 brainstorming 阶段：

- **禁写** `spec.md` / `dev-plan.md` / 任何 `src/` 代码 / `progress.md`
- **禁调** Planner / Tech Lead / SA / QA / Evaluator 子代理
- **禁推进** 状态机（不要碰 progress.md）
- **唯一允许写**的文件是 `doc/<id>.<slug>/requirements.md`
- 用户**显式批准** requirements.md 之前不要 invoke `/cc-nexs:run`

每一项都强制。即使需求看起来"显然简单"，也必须走完这个对话循环——这正是减少后续返工的环节。

## 反模式："太简单了不需要 brainstorm"

todo list、单接口、改个文案——一样要走。简单需求里恰恰是隐藏假设最容易出问题的地方。简单需求对应短对话（可能 2-3 个问题就够），但**不能跳过**。

## 流程清单（必须按顺序）

按顺序完成下列动作。每一项做完再做下一项，不要并行。

1. **加载现状**：读 `doc/<id>.<slug>/requirements.md`、模板章节锚点、最近 git 提交
2. **判断规模**：如果一句话诉求实际上覆盖了多个独立子系统（"做个含聊天/支付/分析的平台"），先停下让用户拆分；每个子系统各起一份 requirements.md
3. **逐题澄清**：一次只问一个问题；优先多选题，必要时开放问答
4. **方案对比**：在涉及方向选择处给 2-3 个方案 + 权衡 + 你的推荐
5. **分章节呈现**：按 requirements.md 模板章节顺序，每写完一节问"对吗"，得到 OK 再下一节
6. **写回文件**：用 Edit 工具填充对应章节（不要 Write 整文件覆盖）
7. **自检**：占位符 / 内部矛盾 / 范围 / 歧义四项扫一遍，发现问题就地修
8. **用户终审**：让用户看 `requirements.md` 全文，明确批准后才结束
9. **交棒**：建议用户跑 `/cc-nexs:run <id>`（或 `/cc-nexs:planner <id>` 单步）

终态是"用户批准 + 提示跑 /cc-nexs:run"。**不要**自己去 invoke run，也不要去写 spec.md。

## requirements.md 章节锚点

模板（`packages/preset-nexs/templates/requirements.md`）已经有这些章节，对话围绕填它们：

| 章节 | 关键问题 | 写入要点 |
|------|----------|----------|
| **业务背景** | 为什么做？谁会用？不做会怎样？ | 用 3-5 行讲清楚动机，不展技术 |
| **用户故事** | 关键角色和最小可用路径是什么？ | "作为 X，我希望 Y，以便 Z" 列 ≥ 3 条 |
| **功能清单** | P0 / P1 / P2 怎么切？ | 表格列功能 + 优先级；P0 必须能成单独发布 |
| **非目标** | 这次明确不做什么？ | 至少列 2 条；YAGNI 体现在这里 |
| **业务规则** | 金额 / 权限 / 状态机 / 文案的硬约束？ | 中文描述业务含义 |
| **外部依赖** | 上游 / 下游 / 三方？ | 没有就写"无" |

> 注：`spec.md` 才放技术方案、AC 表、Sprint 切片。**不要在 brainstorming 里写技术细节**——那是 Planner 的活。如果用户开始聊技术方案，温和地引导回业务侧或记到对话备忘留给 Planner。

## 提问纪律

- **一次一问**：每条消息只一个问题。一个问题里塞多个子问题会把用户压垮，回答也低质
- **多选优先**：能 A/B/C 的就别开放式问。例如"P0 应该包含哪些？\n- A. 只下单\n- B. 下单 + 退款\n- C. 下单 + 退款 + 对账"
- **YAGNI**：用户没要的功能不要主动加。每加一个功能问自己"这是用户要的还是我推测的"
- **对方案先推荐再展示**：写"我推荐 B，因为…，但 A 在 X 场景下更好"，不要罗列三个方案让用户自己挑
- **被纠正立即转向**：用户说"不是这个方向"立刻停下重定位，不要硬推

## 自检清单（写完 requirements.md 后）

新眼光过一遍：

1. **占位符**：还有没有 `TBD` / `TODO` / 空表格行 / "待定"
2. **内部一致性**：功能清单里的功能是否都对应一条用户故事？非目标和功能清单有没有打架？
3. **范围**：这一份 requirements.md 是不是真的能在一个 spec.md 里覆盖完？还是又长出多个子系统？
4. **歧义**：每一条业务规则，能不能被两个开发理解成两件事？

发现问题就地改，**不要**再起一轮对话。改完直接进用户终审。

## 用户终审话术

```
requirements.md 已写完并保存到 doc/<id>.<slug>/requirements.md。

主要内容：
- 业务背景：…（一句话回放）
- 功能清单：P0 共 N 项 / P1 共 M 项 / 非目标 K 项
- 关键业务规则：…

请打开文件确认。如果改动方向 OK：
  /cc-nexs:run <id>
就会启动 Planner 把它展开成 spec.md。
如果还想调整，告诉我哪一节，我就地改。
```

不要自动跑 /cc-nexs:run。等用户主动说"开始"。

## 与 Planner 的边界

Brainstorming 输出 = Planner 输入。两者职责不重叠：

| 关注点 | brainstorming | Planner |
|--------|---------------|---------|
| 业务诉求 / 用户场景 | ✅ 主战场 | 只读 |
| 优先级 / 非目标 | ✅ 由用户决策 | 只读 |
| 技术方案 / 架构选型 | ❌ 不展开 | ✅ 主战场 |
| 验收契约 AC 表 | ❌ 不写 | ✅ 主战场 |
| Sprint 切片 | ❌ 不写 | ✅ 主战场 |
| 影响范围（代码层面） | ❌ 不写 | ✅ 主战场 |

**判定原则**：如果一个细节用户能拍板就放 requirements.md；如果需要看 src/ 才能定就交给 Planner。

## 与其他 cc-nexs skill 的协作

- `using-cc-nexs`：流水线总入口提示。本 skill 是它推荐的"第一段"
- `role-isolation`：brainstorming 不属于五方任一身份，但仍遵守"不读 src/、不写 spec/code"的边界
- `md-aggregation`：requirements.md 没有"多轮 append"的概念，但**变更记录表**要按模板维护

## 不做什么

- **不做 visual companion**：cc-nexs 是终端 + 文件流；浏览器原型不在 scope。如果用户真要看图，引导他用别的工具（Figma / 手画），把决策写进 requirements.md 即可
- **不写 design 文档**：requirements.md 就是输出。不要再生一个 brainstorm.md / design.md 污染 doc/<id>/ 目录
- **不主动调子代理**：保持在主 session 完成对话，避免上下文丢失
