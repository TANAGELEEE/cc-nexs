---
description: "Switch one task to an explicitly authorized non-production test environment."
disable-model-invocation: true
allowed-tools: "Read, Bash"
argument-hint: "--request <json-file>"
---

# /cc-nexs:switch-test-target

Run `node <plugin-root>/lib/cc-nexs-cli.mjs switch-test-target --request <json-file>`.
The request contains `featureId`, `authorizationEvidence` (the user's actual instruction), and `target`:

```json
{"featureId":"05-demo","authorizationEvidence":"User requested test02","target":{"kind":"test","environment":"test02","branches":{"backend":"test02"},"allowed_hosts":["test02.example.com"],"app_url":"https://test02.example.com","operations_url":"https://test02.example.com/ops"}}
```

Bind every deployed code repository, excluding approved local-only repositories. This does not change the implementation scope, global workspace or driver. Active deployments must finish before switching; do not fabricate cancellation. Old attempt evidence remains immutable but invalidated. The controller clears release approval and resumes TEST_RELEASE with the unchanged candidate. Execute the existing release-test control immediately, then verify the new environment. Never use this to authorize production.
