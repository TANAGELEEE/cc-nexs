# Contributing

Contributions should keep the public core independent of any one product,
company, repository layout, user account, or model identifier.

Before submitting a change, run:

```sh
pnpm build
pnpm test:security
pnpm test:hooks
pnpm audit:public
pnpm validate:plugins
```

Do not commit credentials, private hostnames, internal IP addresses, personal
home paths, production data, runtime state, worktrees, or organization-specific
presets. Use reserved example domains and placeholder identities in tests and
documentation. Report security issues according to `SECURITY.md` instead of a
public issue.

Generated `dist/` content must be rebuilt and committed with its corresponding
source change. Tests and fixtures must not be included in release artifacts.
