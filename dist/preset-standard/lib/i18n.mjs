// cc-nexs core: i18n loader.
// Loads locale strings for both core (engine messages) and the active preset (role / template strings).
// Strategy: deep-merge `core/i18n/<locale>.json` <- `preset/i18n/<locale>/strings.json` (preset overrides core).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_I18N_DIR = resolve(fileURLToPath(import.meta.url), '../../i18n');

function deepMerge(base, override) {
  if (override === null || override === undefined) return base;
  if (typeof override !== 'object' || Array.isArray(override)) return override;
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(override)) {
    out[k] = deepMerge(out[k], v);
  }
  return out;
}

export function loadI18n({ locale = 'en-US', presetRoot = null } = {}) {
  const corePath = join(CORE_I18N_DIR, `${locale}.json`);
  let strings = {};
  if (existsSync(corePath)) {
    strings = JSON.parse(readFileSync(corePath, 'utf-8'));
  } else {
    // Fallback to en-US if requested locale missing
    const fallback = join(CORE_I18N_DIR, 'en-US.json');
    strings = JSON.parse(readFileSync(fallback, 'utf-8'));
  }

  if (presetRoot) {
    const presetPath = join(presetRoot, 'i18n', locale, 'strings.json');
    if (existsSync(presetPath)) {
      const presetStrings = JSON.parse(readFileSync(presetPath, 'utf-8'));
      strings = deepMerge(strings, presetStrings);
    }
  }

  return {
    locale,
    strings,
    /** Lookup by dot path, e.g. t('messages.human_gate_summary_header') */
    t(path, fallback = '') {
      const parts = path.split('.');
      let cur = strings;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
        else return fallback || path;
      }
      return cur;
    },
  };
}
