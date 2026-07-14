# API 文档 — {编号}.{需求短名}

> **负责人**：Tech Lead
> **产出规则**：按 sprint append。

---

## Sprint M1

### `POST /api/xxx/yyy` — {接口短名}

- **关联契约**：AC-001
- **鉴权**：是 / 否
- **幂等**：是 / 否

**Request**
```json
{
  "field": "value"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| field | string | Y | ... |

**Response 200**
```json
{
  "code": 0,
  "data": { ... }
}
```

**错误码**
| code | 含义 | 英文响应 message |
|------|------|-----------------|
| 1001 | 参数非法 | "invalid parameter: xxx" |

**示例 curl**
```bash
curl -X POST https://.../api/xxx/yyy \
  -H "Authorization: Bearer ..." \
  -d '{"field":"value"}'
```

---

## Sprint M2

（append）
