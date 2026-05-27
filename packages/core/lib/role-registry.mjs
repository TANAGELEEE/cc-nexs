// cc-nexs core: role registry.
// Resolves role definitions from the active preset and exposes:
//   - listEnabled(): ordered roles to invoke
//   - get(name): { agent, tool, alias, sessionIsolation }
//   - allowedFiles(name): {read, write} guidance (preset-declared, used by hooks)

import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_DEFINITIONS = {
  planner: { agent: 'agents/planner.md', tool: 'claude-subagent', session_isolation: 'independent' },
  'tech-lead': { agent: 'agents/tech-lead.md', tool: 'claude-subagent', session_isolation: 'independent' },
  developer: { agent: 'agents/developer.md', tool: 'claude-subagent', session_isolation: 'independent' },
  sa: { agent: 'agents/sa.md', tool: 'codex' },
  qa: { agent: 'agents/qa.md', tool: 'codex' },
  evaluator: { agent: 'agents/evaluator.md', tool: 'codex' },
  reviewer: { agent: 'agents/reviewer.md', tool: 'claude-subagent', session_isolation: 'independent' },
};

export class RoleRegistry {
  constructor({ preset, presetRoot }) {
    if (!preset || !presetRoot) {
      throw new Error('[cc-nexs] RoleRegistry requires preset + presetRoot');
    }
    this.presetRoot = presetRoot;
    this.enabled = preset.roles?.enabled || [];
    this.definitions = preset.roles?.definitions || {};
  }

  listEnabled() {
    return [...this.enabled];
  }

  get(name) {
    const fromPreset = this.definitions[name];
    const fallback = DEFAULT_DEFINITIONS[name];
    const merged = { ...(fallback || {}), ...(fromPreset || {}) };
    if (!merged.agent && !merged.tool) {
      throw new Error(`[cc-nexs] Role "${name}" not defined in preset or core defaults`);
    }
    return {
      name,
      agent: merged.agent,
      agentPath: merged.agent ? resolve(this.presetRoot, merged.agent) : null,
      tool: merged.tool,
      alias: merged.alias || name,
      sessionIsolation: merged.session_isolation || 'independent',
    };
  }

  /**
   * Read agent .md frontmatter to extract `allowed_read` / `allowed_write` lists.
   * Returns null if agent file or frontmatter not present.
   */
  allowedFiles(name) {
    const role = this.get(name);
    if (!role.agentPath || !existsSync(role.agentPath)) return null;
    const text = readFileSync(role.agentPath, 'utf-8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return null;
    const lines = fm[1].split('\n');
    const result = { read: [], write: [], forbidden_read: [], forbidden_write: [] };
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^(allowed_read|allowed_write|forbidden_read|forbidden_write):/);
      if (m) { cur = m[1]; continue; }
      if (cur && line.startsWith('  - ')) {
        result[cur].push(line.slice(4).replace(/^["']|["']$/g, ''));
      } else if (cur && !line.startsWith(' ')) {
        cur = null;
      }
    }
    return result;
  }
}
