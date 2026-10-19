# API 文件 — {編號}.{需求短名}

> **負責人**：Tech Lead
> **產出規則**：按 sprint append。

---

## Sprint M1

### `POST /api/xxx/yyy` — {介面短名}

- **關聯契約**：AC-001
- **鑑權**：是 / 否
- **冪等**：是 / 否

**Request**
```json
{
  "field": "value"
}
```

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| field | string | Y | ... |

**Response 200**
```json
{
  "code": 0,
  "data": { ... }
}
```

**錯誤碼**
| code | 含義 | 英文響應 message |
|------|------|-----------------|
| 1001 | 引數非法 | "invalid parameter: xxx" |

**示例 curl**
```bash
curl -X POST https://.../api/xxx/yyy \
  -H "Authorization: Bearer ..." \
  -d '{"field":"value"}'
```

---

## Sprint M2

（append）
