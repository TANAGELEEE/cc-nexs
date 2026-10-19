# API Documentation — {id}.{feature-slug}
> **Owner**: Tech Lead
> **Output rule**: Append per sprint.

---
## Sprint M1

### `POST /api/xxx/yyy` — {endpoint name}
- **Related contract**: AC-001
- **Authentication**: Yes / No
- **Idempotency**: Yes / No

**Request**
```json
{
  "field": "value"
}
```

| Field | Type | Required | Description |
|------|------|------|------|
| field | string | Y | ... |

**Response 200**
```json
{
  "code": 0,
  "data": { ... }
}
```
**Error Codes**
| code | Meaning | English response message |
|------|------|-----------------|
| 1001 | Invalid parameter | "invalid parameter: xxx" |
**Example curl**
```bash
curl -X POST https://.../api/xxx/yyy \
  -H "Authorization: Bearer ..." \
  -d '{"field":"value"}'
```

---

## Sprint M2

（append）
