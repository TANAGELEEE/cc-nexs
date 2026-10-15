import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function runtimeIdentity(pluginRoot = null) {
  const root = pluginRoot || dirname(dirname(fileURLToPath(import.meta.url)));
  let version = 'unknown';
  for (const file of [join(root, 'package.json'), join(root, '.claude-plugin', 'plugin.json'), join(root, '.codex-plugin', 'plugin.json'), join(root, '..', 'package.json'), join(root, '..', '..', 'package.json')]) {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof value.version === 'string') { version = value.version; break; }
    } catch {}
  }
  return { name: 'cc-nexs', version };
}

export function assertRuntimeCompatible(progress, identity) {
  const bound = progress?.runtime;
  if (!bound) return;
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(identity.version);
  const previous = /^(\d+)\.(\d+)\.(\d+)$/.exec(bound.version);
  if (bound.name === identity.name && current && previous
    && current[1] === previous[1] && current[2] === previous[2]
    && Number(current[3]) >= Number(previous[3])) return;
  if (bound.name === identity.name && bound.version === identity.version) return;
  throw new Error(`[cc-nexs] runtime version mismatch: task=${bound.name}@${bound.version}, current=${identity.name}@${identity.version}; resume with the installed compatible or newer patch runtime`);
}
