import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findProjectConfigRoot(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(join(current, 'cc-nexs.config.yml'))
      || existsSync(join(current, 'cc-nexs.config.json'))
      || existsSync(join(current, '.cc-nexs', 'workspace.yml'))
      || existsSync(join(current, '.cc-nexs', 'workspace.json'))
    ) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function configuredPluginRoot(env = process.env) {
  return env.CC_NEXS_PLUGIN_ROOT
    || env.CLAUDE_PLUGIN_ROOT
    || env.CODEX_PLUGIN_ROOT
    || env.PLUGIN_ROOT
    || null;
}
