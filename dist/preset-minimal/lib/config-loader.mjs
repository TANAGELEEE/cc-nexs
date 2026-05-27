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

function parseYaml(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+#.*$/, ''));
  const root = {};
  const stack = [{ indent: -1, container: root, key: null }];

  for (let raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const top = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      const item = line.slice(2);
      const parent = top.container;
      if (!Array.isArray(parent)) {
        const k = top.key;
        const newArr = [];
        const grand = stack[stack.length - 2];
        grand.container[k] = newArr;
        stack[stack.length - 1] = { indent, container: newArr, key: null };
      }
      const arr = stack[stack.length - 1].container;
      if (item.includes(':')) {
        const obj = {};
        arr.push(obj);
        const [k, ...rest] = item.split(':');
        const v = rest.join(':').trim();
        if (v) obj[k.trim()] = parseScalar(v);
        else stack.push({ indent: indent + 2, container: obj, key: k.trim() });
      } else {
        arr.push(parseScalar(item));
      }
    } else if (line.includes(':')) {
      const [k, ...rest] = line.split(':');
      const key = k.trim();
      const v = rest.join(':').trim();
      const parent = top.container;
      if (v === '') {
        parent[key] = {};
        stack.push({ indent, container: parent[key], key });
      } else {
        parent[key] = parseScalar(v);
      }
    }
  }
  return root;
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
