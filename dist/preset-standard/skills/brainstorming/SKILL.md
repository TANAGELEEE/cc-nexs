---
name: "brainstorming"
description: "在显式 cc-nexs brainstorm 中澄清模糊需求并更新 requirements.md。需求完整时可跳过；不作为写代码或计划的通用前置步骤。"
disable-model-invocation: true
---

# 澄清需求

仅在用户调用 brainstorm 或当前流程明确需要澄清时使用。目标是形成可供 Planner 使用的 requirements.md，不增加 Gateway A / G1 之外的审批门禁。

读取已定位的 requirements.md、当前模式模板和与问题直接相关的项目资料。沿用用户已经确认的范围；可由现状确定的细节自行补齐。只问会影响业务范围、验收或授权且无法从现有信息确定的问题，可合并紧密相关的问题。等待答案时继续整理独立部分。

围绕背景、用户场景、优先级、非目标、业务规则和外部依赖补全需求。条目数量随实际需求确定；不为凑数量虚构故事、替代方案或非目标。技术约束如影响业务可记录，详细实施方案交给 Planner。

只修改当前需求的 requirements.md，保留元信息与变更记录；不修改 spec、代码或 progress，也不派发实现或评审角色。若已存在批准范围，走命令指定的 scope-change 流程，不直接改写已批准需求。

检查遗漏、矛盾和可验收性，交付完整草稿与尚待决定的问题。无需逐节确认或再次批准已确认事项。用户只要求脑暴时在交付草稿后结束；已授权继续规划且没有关键缺口时，Lean 进入 plan，Fast/Full 进入 run，由正式门禁承接审批。
