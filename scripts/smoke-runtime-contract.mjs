#!/usr/bin/env node
// Deterministic runtime contract smoke for cc-nexs document locations and mode semantics.
//
// This does not invoke an LLM. It proves the packaged templates, state-machine module,
// Lean state and hotfix document locations line up with the shared SOP.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist', 'preset-standard');
const TEMPLATES = join(DIST, 'templates');
const errors = [];
const tmp = mkdtempSync(join(tmpdir(), 'cc-nexs-runtime-contract-'));
const repo = join(tmp, 'repo');
const allDocs = join(repo, 'all-docs');

function fail(message) {
  errors.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || repo,
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
  });
}

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else if (st.isFile()) copyFileSync(s, d);
  }
}

function rewritePlaceholders(dir, id, slug) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      rewritePlaceholders(p, id, slug);
    } else if (st.isFile() && /\.(md|json)$/.test(entry)) {
      const text = readFileSync(p, 'utf-8')
        .replaceAll('{编号}', id)
        .replaceAll('{需求短名}', slug);
      writeFileSync(p, text, 'utf-8');
    }
  }
}

function initLeanFeature({ id, slug }) {
  const reqDir = join(allDocs, 'doc', `${id}.${slug}`);
  copyDir(join(TEMPLATES, 'lean'), reqDir);
  rewritePlaceholders(reqDir, id, slug);
  return reqDir;
}

function initHotfixFeature({ id, slug }) {
  const reqDir = join(allDocs, 'doc', `${id}.${slug}`);
  copyDir(join(TEMPLATES, 'hotfix'), reqDir);
  rewritePlaceholders(reqDir, id, slug);
  return reqDir;
}

function assertHotfixDocs(reqDir) {
  for (const rel of ['hotfix.md', 'config.json', 'progress.json', 'progress.md']) {
    assert(existsSync(join(reqDir, rel)), `${reqDir}: missing Hotfix artifact ${rel}`);
  }
  for (const rel of ['README.md', 'requirements.md', 'plan.md', 'spec.md', 'bugs', 'qa-scripts']) {
    assert(!existsSync(join(reqDir, rel)), `${reqDir}: Hotfix must not create ${rel}`);
  }
  assert(readFileSync(join(reqDir, 'hotfix.md'), 'utf8').includes('HOTFIX-SCOPE START'), 'Hotfix scope marker missing');
  const config = JSON.parse(readFileSync(join(reqDir, 'config.json'), 'utf8'));
  assert(config.mode === 'hotfix', 'Hotfix config mode must be hotfix');
  assert(config.config_version === 2, 'Hotfix config_version must be 2');
  assert(config.risk_tier === 'auto', 'Hotfix risk_tier must default to auto');
  assert(!config.models?.roles, 'Hotfix template must not shadow project models.roles');
  assert(JSON.parse(readFileSync(join(reqDir, 'progress.json'), 'utf8')).mode === 'hotfix', 'Hotfix progress mode must be hotfix');
}

function assertLeanDocs(reqDir) {
  for (const rel of ['requirements.md', 'plan.md', 'config.json', 'progress.json', 'progress.md']) {
    assert(existsSync(join(reqDir, rel)), `${reqDir}: missing Lean artifact ${rel}`);
  }
  for (const rel of ['README.md', 'spec.md', 'test-report.md', 'acceptance.md', 'bugs']) {
    assert(!existsSync(join(reqDir, rel)), `${reqDir}: Lean must not create ${rel}`);
  }
  assert(readFileSync(join(reqDir, 'plan.md'), 'utf8').includes('APPROVAL-SCOPE START'), 'Lean plan approval marker missing');
  const config = JSON.parse(readFileSync(join(reqDir, 'config.json'), 'utf8'));
  assert(config.mode === 'lean', 'Lean config mode must be lean');
  assert(config.config_version === 2, 'Lean config_version must be 2');
  assert(config.risk_tier === 'auto', 'Lean risk_tier must default to auto');
  assert(!config.models?.roles, 'Lean template must not shadow project models.roles');
  assert(JSON.parse(readFileSync(join(reqDir, 'progress.json'), 'utf8')).mode === 'lean', 'Lean progress mode must be lean');
}

function assertNoWrongLocations(id, slug) {
  const wrong = [
    join(repo, 'doc', `${id}.${slug}`),
    join(repo, 'codex-docs'),
    join(repo, 'bugs'),
    join(repo, 'qa-scripts'),
    join(allDocs, 'all-docs'),
    join(allDocs, 'codex-docs'),
  ];
  for (const p of wrong) {
    assert(!existsSync(p), `unexpected wrong document location exists: ${p}`);
  }
}

function expectStep(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    assert(actual[key] === value, `${label}: expected ${key}=${value}, got ${actual[key]}`);
  }
}

async function assertStateMachine() {
  const mod = await import(pathToFileURL(join(DIST, 'lib', 'state-machine.mjs')).href);
  const leanRoles = ['lean-planner', 'lean-developer', 'lean-reviewer', 'lean-verifier'];
  const hotfixRoles = ['hotfix-developer', 'hotfix-reviewer', 'hotfix-verifier'];

  expectStep(
    mod.nextStep({ state: 'INIT', enabledRoles: leanRoles, mode: 'lean' }),
    { next: 'PLANNING', role: 'lean-planner', action: 'draft_plan' },
    'lean INIT',
  );
  expectStep(
    mod.nextStep({ state: 'IMPLEMENTING', enabledRoles: leanRoles, mode: 'lean' }),
    { next: 'LOCAL_VERIFYING', role: null, action: 'verify_local' },
    'lean local verification',
  );
  expectStep(
    mod.nextStep({ state: 'LOCAL_VERIFYING', enabledRoles: leanRoles, mode: 'lean' }),
    { next: 'CONSOLIDATED_REVIEW', role: 'lean-reviewer', action: 'review_candidate' },
    'lean consolidated review',
  );
  const leanReleaseGate = mod.nextStep({ state: 'TEST_VERIFIED', enabledRoles: leanRoles, mode: 'lean' });
  expectStep(leanReleaseGate, { next: 'RELEASE_PENDING_HUMAN', action: 'await_release_approval' }, 'lean release gate');
  assert(leanReleaseGate.stop === true, 'Lean release gate must stop for human approval');

  expectStep(
    mod.nextStep({ state: 'HOTFIX_LOCAL_VERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { hotfix: { severity: 'P2' } } }),
    { next: 'HOTFIX_REVIEWING', role: 'hotfix-reviewer', action: 'review_hotfix' },
    'hotfix concentrated Review',
  );
  expectStep(
    mod.nextStep({ state: 'HOTFIX_LOCAL_VERIFYING', enabledRoles: hotfixRoles, mode: 'hotfix', workflow: { hotfix: { severity: 'P3' } } }),
    { next: 'HOTFIX_REVIEWING', role: 'hotfix-reviewer', action: 'review_hotfix' },
    'hotfix P3 requires independent Review',
  );
  const hotfixGate = mod.nextStep({ state: 'HOTFIX_TEST_VERIFIED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  expectStep(hotfixGate, { next: 'HOTFIX_RELEASE_PENDING_HUMAN', action: 'await_release_approval' }, 'hotfix Gateway B');
  assert(hotfixGate.stop === true, 'Hotfix release gate must stop for human approval');

  for (const mode of ['fast', 'full']) {
    let rejected = false;
    try { mod.nextStep({ state: 'INIT', enabledRoles: leanRoles, mode }); } catch { rejected = true; }
    assert(rejected, `removed ${mode} mode must be rejected`);
  }
}

async function assertModelRouting() {
  const { loadConfig } = await import(pathToFileURL(join(DIST, 'lib', 'config-loader.mjs')).href);
  const { resolveRoleRuntime } = await import(pathToFileURL(join(DIST, 'lib', 'runtime-resolver.mjs')).href);
  const config = loadConfig({ projectRoot: repo, presetRoot: DIST });
  for (const runtime of ['claude', 'codex', 'pi']) {
    const planner = resolveRoleRuntime(config.preset, 'lean-planner', runtime, {
      models: config.mergedModels,
      featureConfig: { config_version: 2, mode: 'lean', risk_tier: 'auto' },
      progress: { mode: 'lean' },
      planText: '<!-- APPROVAL-SCOPE START -->\n- risk_tier: high\n<!-- APPROVAL-SCOPE END -->',
    });
    assert(planner.model_profile === 'escalated', `${runtime}: high-risk Planner must use escalated`);
    assert(planner.model === 'inherit' && planner.effort === 'xhigh', `${runtime}: public escalated must be inherit/xhigh`);
    assert(planner.model_routing.matched_rules.includes('lean-high-risk'), `${runtime}: missing Lean routing rule evidence`);
    const reviewer = resolveRoleRuntime(config.preset, 'hotfix-reviewer', runtime, {
      models: config.mergedModels,
      featureConfig: { config_version: 2, mode: 'hotfix', risk_tier: 'auto' },
      progress: { mode: 'hotfix', hotfix: { severity: 'P1' } },
    });
    assert(reviewer.model_profile === 'escalated', `${runtime}: P1 Hotfix Reviewer must use escalated`);
    assert(reviewer.model_routing.matched_rules.includes('hotfix-p0-p1'), `${runtime}: missing Hotfix routing rule evidence`);
  }

  const legacyPlanText = '<!-- APPROVAL-SCOPE START -->\n- risk_tier: critical\n<!-- APPROVAL-SCOPE END -->\n';
  const legacyScopeHash = createHash('sha256').update('\n- risk_tier: critical\n').digest('hex');
  const legacyReviewer = resolveRoleRuntime(config.preset, 'lean-reviewer', 'codex', {
    models: config.mergedModels,
    featureConfig: { config_version: 2, mode: 'lean', risk_tier: 'auto' },
    progress: { mode: 'lean', gates: { plan: { approved: true, binding: { plan_scope_sha256: legacyScopeHash } } } },
    planText: legacyPlanText,
  });
  assert(legacyReviewer.model_profile === 'escalated', 'legacy hash-derived critical risk must escalate Reviewer');
  assert(legacyReviewer.model_routing.source === 'gateway_a_hashed_scope_derived', 'legacy risk source must be hash-derived');

  const unknownLegacyReviewer = resolveRoleRuntime(config.preset, 'lean-reviewer', 'codex', {
    models: config.mergedModels,
    featureConfig: { config_version: 2, mode: 'lean', risk_tier: 'auto' },
    progress: { mode: 'lean', gates: { plan: { approved: true, binding: {} } } },
    planText: legacyPlanText,
  });
  assert(unknownLegacyReviewer.model_routing.risk_tier === 'high', 'unknown legacy Gateway A risk must use high floor');
  assert(unknownLegacyReviewer.model_profile === 'escalated', 'unknown legacy Gateway A risk must escalate Reviewer');
}

function assertAllDocsGitAddOnlyFeatureDir(id, slug) {
  run('git', ['-C', allDocs, 'add', `doc/${id}.${slug}/`]);
  const names = run('git', ['-C', allDocs, 'diff', '--cached', '--name-only'])
    .split('\n')
    .filter(Boolean);
  assert(names.length > 0, 'all-docs staged file list should not be empty');
  for (const name of names) {
    assert(name.startsWith(`doc/${id}.${slug}/`), `all-docs staged unexpected path: ${name}`);
  }
}

try {
  if (!existsSync(join(DIST, '.codex-plugin', 'plugin.json'))) {
    fail(`${DIST}: missing built plugin artifacts; run pnpm build first`);
  }
  mkdirSync(repo, { recursive: true });
  run('git', ['init', '-q'], { cwd: repo });
  mkdirSync(allDocs, { recursive: true });
  run('git', ['init', '-q'], { cwd: allDocs });

  const leanReq = initLeanFeature({ id: '03', slug: 'runtime-lean' });
  assertLeanDocs(leanReq);
  assertNoWrongLocations('03', 'runtime-lean');

  const hotfixReq = initHotfixFeature({ id: '04', slug: 'runtime-hotfix' });
  assertHotfixDocs(hotfixReq);
  assertNoWrongLocations('04', 'runtime-hotfix');

  await assertStateMachine();
  await assertModelRouting();

  assertAllDocsGitAddOnlyFeatureDir('03', 'runtime-lean');

  const solutionDir = join(repo, 'docs', 'solutions');
  mkdirSync(solutionDir, { recursive: true });
  writeFileSync(join(solutionDir, 'payment-callback-timeout.md'), '# payment callback timeout\n', 'utf-8');
  assert(existsSync(join(repo, 'docs', 'solutions', 'payment-callback-timeout.md')), 'compound learning must be under docs/solutions/');
  assert(!existsSync(join(allDocs, 'docs', 'solutions')), 'compound learning must not be under all-docs/docs/solutions/');

  if (errors.length > 0) {
    console.error('Runtime contract smoke failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Runtime contract smoke passed: lean-default and standalone hotfix document/state semantics');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
