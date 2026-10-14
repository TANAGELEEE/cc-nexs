# 部署文档 — {编号}.{需求短名}

> **负责人**：Tech Lead
> **必含**：回滚步骤章节（独立二级标题，不可省略）。

---

## 环境清单

| 环境 | 地址 | 用途 |
|------|------|------|
| dev  |      |      |
| test |      |      |
| prod |      |      |

> test/prod 不得共用 URL。自动流程只读取私有 overlay/project config 的 `release.test.app_url`、`operations_url`、`allowed_hosts` 和 driver；生产发布始终人工。

## Test release driver

| 项目 | 值 |
|---|---|
| test branch / 仓库顺序 | 见 `.cc-nexs/workspace.yml` 的 `test_branch` / `release_order` |
| driver | `release.test.driver`（stdin/stdout JSON 契约） |
| app URL | `release.test.app_url` |
| operations URL | `release.test.operations_url` |
| browser session | 复用当前已登录会话 |
| credential ref | 仅记录 opaque ref；禁止账号、密码、token 明文 |

## 部署顺序

1. DB 迁移（SQL 文件：`*.sql`）
2. 配置中心变更
3. 服务发布（灰度顺序）
4. 冒烟验证

## 配置变更

| Key | 环境 | 旧值 | 新值 | 生效方式 |
|-----|------|------|------|---------|
|     |      |      |      |         |

## DB 迁移

| SQL 文件 | 作用 | 是否破坏兼容 | 预计耗时 |
|---------|------|-------------|---------|
|         |      |             |         |

## 三方依赖 / 资源

- 新增环境变量：
- 新增云资源：
- 新增密钥：

## 监控 / 告警

- 新增指标：
- 新增告警规则：

## 灰度策略

- 灰度阶段：
- 观察指标：
- 达标判据：

---

## 回滚步骤 ⚠️ 必读

### 触发条件
- 严重 bug 定义：
- 性能劣化阈值：

### 回滚动作（按顺序）
1. **服务层回滚**：
2. **配置回滚**：
3. **DB 回滚**：
4. **缓存清理**：
5. **验证点**：

### 回滚后复盘
- 回滚完成后 24h 内产出故障报告（PM + Tech Lead）
- 回滚不清除 bugs/ 目录，bug 生命周期正常继续
