# Deployment Guide — {id}.{feature-slug}
> **Owner**: Tech Lead
> **Must include**: Rollback steps section (standalone H2 heading, mandatory).

---
## Environment Inventory

| Environment | Address | Purpose |
|------|------|------|
| dev  |      |      |
| test |      |      |
| prod |      |      |
> test/prod must not share URLs. Automated flows read only `release.test.app_url`, `operations_url`, `allowed_hosts`, and the driver from the private overlay/project config; production releases always remain manual.
## Test release driver

| Item | Value |
|---|---|
| test branch / release order | See `test_branch` / `release_order` in `.cc-nexs/workspace.yml` |
| driver | `release.test.driver` (stdin/stdout JSON contract) |
| app URL | `release.test.app_url` |
| operations URL | `release.test.operations_url` |
| browser session | Reuse the currently logged-in session |
| credential ref | Only opaque refs are recorded; plaintext accounts, passwords, and tokens are prohibited |

## Deployment Order
1. DB migration (SQL file: `*.sql`)
2. Config center changes
3. Service release (canary order)
4. Smoke verification
## Configuration Changes

| Key | Environment | Old Value | New Value | Effective Method |
|-----|------|------|------|---------|
|     |      |      |      |         |

## DB Migration

| SQL File | Purpose | Breaks Compatibility | Estimated Duration |
|---------|------|-------------|---------|
|         |      |             |         |

## Third-Party Dependencies / Resources
- Added environment variables：
Added cloud resources:
- Add a new key：
## Monitoring / Alerts
- New metrics:
- New alert rules:
## Canary Strategy
- Canary phase:
- Metrics to monitor:
- Success criteria:

---
## Rollback Steps ⚠️ Required

### Trigger Conditions
- Critical bug definition:
- Performance degradation threshold:
### Rollback Actions (in Order)
1. **Service-layer rollback**:
2. **Configuration rollback**:
3. **DB rollback**:
4. **Cache cleanup**:
5. **Verification points**:
### Post-Rollback Review
- Produce an incident report within 24h after rollback is complete (PM + Tech Lead)
- Rollback does not clear the `bugs/` directory; the bug lifecycle continues normally
