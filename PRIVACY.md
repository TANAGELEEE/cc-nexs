# Privacy

cc-nexs does not include telemetry or an analytics service.

The tool reads repository files and writes workflow artifacts locally. When a
Claude Code or Codex role is enabled, the files and prompts selected by that
role are processed by the configured AI provider under that provider's terms
and the user's account settings. cc-nexs does not proxy or separately retain
that traffic.

Users are responsible for reviewing role inputs before execution. Do not put
credentials, personal data, customer data, production dumps, or private keys in
prompts, generated artifacts, presets intended for publication, or bug reports.
Keep organization-specific overlays outside the public package.

Runtime state, worktrees, local overlays, and environment files are excluded
from version control by default. The public audit command is a release guard,
not a guarantee that every form of sensitive information can be detected.
