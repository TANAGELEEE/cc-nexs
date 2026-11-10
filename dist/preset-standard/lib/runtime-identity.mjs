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
  // Progress carries its own schema version, so a newer runtime of the same major
  // resumes a task an older one started; only a downgrade is refused.
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(identity.version)?.slice(1).map(Number);
  const previous = /^(\d+)\.(\d+)\.(\d+)$/.exec(bound.version)?.slice(1).map(Number);
  if (bound.name === identity.name && current && previous && current[0] === previous[0]
    && (current[1] > previous[1] || (current[1] === previous[1] && current[2] >= previous[2]))) return;
  if (bound.name === identity.name && bound.version === identity.version) return;
  throw new Error(`[cc-nexs] runtime version mismatch: task=${bound.name}@${bound.version}, current=${identity.name}@${identity.version}; resume with the same or a newer runtime of this major version`);
}
