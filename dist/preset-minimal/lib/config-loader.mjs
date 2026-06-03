// cc-nexs core: configuration loader.
// Reads two files at the project root where the user runs the orchestrator:
//   1. cc-nexs.config.yml — project-level: which preset to use, project id, locale override,
//      threshold overrides, optional paths_override.
//   2. <preset-root>/preset.yml — preset declaration: roles, stack, paths, workflow defaults.
// Resolves them into a single normalized config object.
//
// Both files are YAML; we use a minimal hand-rolled parser to avoid a runtime dependency. Limitations:
//   - Only key:value, nested objects, arrays of strings, arrays of objects, booleans, integers, null.
//   - No anchors / multi-line scalars / flow style.
// This is intentional: presets that need richer YAML can ship JSON instead (loader auto-detects).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';

function parseScalar(s) {
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// Recursive-descent YAML parser. Supports the subset cc-nexs needs:
//   - key: value (with scalars: string, int, float, bool, null)
//   - key:        nested object on next indented line
//   - key:        nested array (- ...) on next indented line
//   - inline flow arrays: key: [a, b, "c"]
//   - array of scalars
//   - array of objects (- key1: v1 / two-space indented siblings)
// Limitations: no anchors, no multi-line strings, no document markers.
//
// Why hand-rolled: cc-nexs intentionally has zero runtime npm deps.
function tryParseInlineArray(s) {
  // "[a, b, c]" → array; otherwise return undefined
  const t = s.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return undefined;
  const inner = t.slice(1, -1).trim();
  if (inner === '') return [];
  const items = [];
  let cur = '';
  let inS = null; // current quote char
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inS) {
      cur += c;
      if (c === '\\') {
        if (i + 1 < inner.length) cur += inner[++i];
      } else if (c === inS) {
        inS = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inS = c;
      cur += c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      items.push(parseScalar(cur.trim()));
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '') items.push(parseScalar(cur.trim()));
  return items;
}

function parseYaml(text) {
  const rawLines = text.split(/\r?\n/);
  // Strip inline comments (`<sp>#...`) but preserve `#` inside quotes — minimal handling.
  const cleaned = rawLines.map((line) => {
    if (line.trim().startsWith('#')) return '';
    let inS = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inS) {
        if (c === '\\' && i + 1 < line.length) i++;
        else if (c === inS) inS = null;
      } else if (c === '"' || c === "'") {
        inS = c;
      } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i).replace(/\s+$/, '');
      }
    }
    return line;
  });

  const lines = [];
  for (const l of cleaned) {
    if (l.trim() === '') continue;
    lines.push(l);
  }
  let pos = 0;

  const indentOf = (l) => l.match(/^ */)[0].length;

  function lookaheadStructure(parentIndent) {
    if (pos >= lines.length) return { kind: 'null' };
    const cur = lines[pos];
    const ind = indentOf(cur);
    if (ind <= parentIndent) return { kind: 'null' };
    return { kind: cur.trim().startsWith('- ') ? 'array' : 'object', indent: ind };
  }

  function parseObject(baseIndent) {
    const obj = {};
    while (pos < lines.length) {
      const cur = lines[pos];
      const ind = indentOf(cur);
      if (ind < baseIndent) break;
      const trimmed = cur.trim();
      if (trimmed.startsWith('- ')) break; // belongs to enclosing array
      if (ind > baseIndent) {
        // Skip — should have been consumed by recursion
        pos++;
        continue;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) {
        pos++;
        continue;
      }
      const key = trimmed.substring(0, colonIdx).trim();
      const rawValue = trimmed.substring(colonIdx + 1).trim();
      pos++;
      if (rawValue !== '') {
        const inline = tryParseInlineArray(rawValue);
        obj[key] = inline !== undefined ? inline : parseScalar(rawValue);
        continue;
      }
      const peek = lookaheadStructure(baseIndent);
      if (peek.kind === 'array') {
        obj[key] = parseArray(peek.indent);
      } else if (peek.kind === 'object') {
        obj[key] = parseObject(peek.indent);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  function parseArray(baseIndent) {
    const arr = [];
    while (pos < lines.length) {
      const cur = lines[pos];
      const ind = indentOf(cur);
      if (ind < baseIndent) break;
      const trimmed = cur.trim();
      if (!trimmed.startsWith('- ')) break;
      if (ind !== baseIndent) break;

      const after = trimmed.substring(2);
      const itemIndent = baseIndent + 2;
      pos++;

      // Case 1: "- key: value"  → object item starting with one inline key
      // Case 2: "- value"        → scalar item
      // Case 3: "-"              → object on next indented line
      const colonIdx = (() => {
        // First top-level ':' outside quotes
        let inS = null;
        for (let i = 0; i < after.length; i++) {
          const c = after[i];
          if (inS) {
            if (c === '\\' && i + 1 < after.length) i++;
            else if (c === inS) inS = null;
          } else if (c === '"' || c === "'") {
            inS = c;
          } else if (c === ':') {
            // Treat as kv only if followed by space or end-of-string
            if (i === after.length - 1 || after[i + 1] === ' ') return i;
          }
        }
        return -1;
      })();

      if (after === '') {
        // Object whose first kv begins on the next line at deeper indent.
        const peek = lookaheadStructure(baseIndent);
        if (peek.kind === 'object') {
          arr.push(parseObject(peek.indent));
        } else if (peek.kind === 'array') {
          arr.push(parseArray(peek.indent));
        } else {
          arr.push(null);
        }
      } else if (colonIdx >= 0) {
        // "- key: value" → start an object whose remaining fields live at itemIndent.
        const obj = {};
        const key = after.substring(0, colonIdx).trim();
        const v = after.substring(colonIdx + 1).trim();
        if (v !== '') {
          const inline = tryParseInlineArray(v);
          obj[key] = inline !== undefined ? inline : parseScalar(v);
        } else {
          // Look ahead at fields nested under this kv (deeper than itemIndent).
          const peek = lookaheadStructure(itemIndent);
          if (peek.kind === 'array') obj[key] = parseArray(peek.indent);
          else if (peek.kind === 'object') obj[key] = parseObject(peek.indent);
          else obj[key] = null;
        }
        // Continue gathering sibling fields of this object at itemIndent.
        while (pos < lines.length) {
          const next = lines[pos];
          const nind = indentOf(next);
          if (nind < itemIndent) break;
          if (nind > itemIndent) {
            // Belongs to a deeper nested value already consumed above.
            pos++;
            continue;
          }
          const ntrim = next.trim();
          if (ntrim.startsWith('- ')) break; // belongs to a parent array, not us
          const ci = ntrim.indexOf(':');
          if (ci < 0) {
            pos++;
            continue;
          }
          const k2 = ntrim.substring(0, ci).trim();
          const v2 = ntrim.substring(ci + 1).trim();
          pos++;
          if (v2 !== '') {
            const inline = tryParseInlineArray(v2);
            obj[k2] = inline !== undefined ? inline : parseScalar(v2);
          } else {
            const peek = lookaheadStructure(itemIndent);
            if (peek.kind === 'array') obj[k2] = parseArray(peek.indent);
            else if (peek.kind === 'object') obj[k2] = parseObject(peek.indent);
            else obj[k2] = null;
          }
        }
        arr.push(obj);
      } else {
        // Scalar / inline array
        const inline = tryParseInlineArray(after);
        arr.push(inline !== undefined ? inline : parseScalar(after));
      }
    }
    return arr;
  }

  // Top level is always an object.
  return parseObject(0);
}

function readStructured(filePath) {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf-8');
  if (extname(filePath) === '.json') return JSON.parse(text);
  return parseYaml(text);
}

/**
 * Resolve config given a project root and an optional explicit preset root.
 * Returns: { project, preset, presetRoot, projectRoot, locale, mergedThresholds, mergedStack }
 */
export function loadConfig({ projectRoot = process.cwd(), presetRoot = null } = {}) {
  const project =
    readStructured(resolve(projectRoot, 'cc-nexs.config.yml')) ||
    readStructured(resolve(projectRoot, 'cc-nexs.config.json')) ||
    {};

  // Resolve preset path: explicit param > config.preset_path > config.preset (well-known name)
  if (!presetRoot) {
    if (project.preset_path) {
      presetRoot = resolve(projectRoot, project.preset_path);
    } else if (project.preset && process.env.CC_NEXS_PRESETS_DIR) {
      presetRoot = resolve(process.env.CC_NEXS_PRESETS_DIR, project.preset);
    }
  }

  let preset = null;
  if (presetRoot) {
    const yml = resolve(presetRoot, 'preset.yml');
    const json = resolve(presetRoot, 'preset.json');
    preset = readStructured(yml) || readStructured(json);
    if (!preset) {
      throw new Error(`[cc-nexs] preset.yml not found under ${presetRoot}`);
    }
  }

  const locale = project.language || preset?.language || 'en-US';

  const presetThresholds = preset?.workflow?.thresholds || {};
  const projectThresholds = project.thresholds || {};
  const mergedThresholds = {
    review_revision: projectThresholds.review_revision ?? presetThresholds.review_revision ?? 3,
    fix_per_bug: projectThresholds.fix_per_bug ?? presetThresholds.fix_per_bug ?? 3,
    evaluator_reject: projectThresholds.evaluator_reject ?? presetThresholds.evaluator_reject ?? 2,
  };

  // Project-level paths_override merges into preset.stack.
  // Use case: public preset ships with generic placeholders like "src/main/java/**";
  // a user's private project injects real module paths via cc-nexs.config.yml without forking the preset.
  const presetStack = preset?.stack ? { ...preset.stack } : {};
  const pathsOverride = project.paths_override || {};
  const mergedStack = {
    ...presetStack,
    ...(pathsOverride.build_cmd !== undefined && { build_cmd: pathsOverride.build_cmd }),
    ...(pathsOverride.test_cmd !== undefined && { test_cmd: pathsOverride.test_cmd }),
    ...(pathsOverride.lint_cmd !== undefined && { lint_cmd: pathsOverride.lint_cmd }),
    ...(Array.isArray(pathsOverride.src_paths) && { src_paths: pathsOverride.src_paths }),
    // Per-module commands. When set, /cc-nexs:build picks per-module build_cmd / test_cmd
    // based on git-diff intersection with each module's `match` globs. Top-level
    // build_cmd / test_cmd act as fallback when no module matches.
    //
    // Schema:
    //   paths_override.modules:
    //     - name: backend
    //       match: ["backend-java/**"]
    //       build_cmd: "cd backend-java && mvn -q compile"
    //       test_cmd:  "cd backend-java && mvn -q test"
    //     - name: web
    //       match: ["web/**"]
    //       build_cmd: "cd web && pnpm build"
    //       test_cmd:  "cd web && pnpm test"
    ...(Array.isArray(pathsOverride.modules) && { modules: pathsOverride.modules }),
    ...(pathsOverride.diff_base !== undefined && { diff_base: pathsOverride.diff_base }),
  };

  return {
    projectRoot,
    project,
    preset,
    presetRoot,
    locale,
    mergedThresholds,
    mergedStack,
  };
}
