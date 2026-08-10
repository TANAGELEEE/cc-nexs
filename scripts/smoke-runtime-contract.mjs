#!/usr/bin/env node
// Deterministic runtime contract smoke for cc-nexs document locations and mode semantics.
//
// This does not invoke an LLM. It proves the packaged templates, state-machine module,
// Lean/full/fast state and hotfix document locations line up with the shared SOP.

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

function initFeature({ id, slug, mode }) {
  const reqDir = join(allDocs, 'doc', `${id}.${slug}`);
  copyDir(TEMPLATES, reqDir);
  rewritePlaceholders(reqDir, id, slug);
  const configPath = join(reqDir, 'config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.mode = mode;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return reqDir;
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

function assertFeatureDocs(reqDir, mode) {
  const required = [
    'README.md',
    'requirements.md',
    'repo-context.md',
    'spec.md',
    'dev-plan.md',
    'api-doc.md',
    'deploy.md',
    'test-cases.md',
    'test-report.md',
    'acceptance.md',
    'progress.md',
    'config.json',
    'bugs/BUG-template.md',
  ];
  for (const rel of required) {
    assert(existsSync(join(reqDir, rel)), `${reqDir}: missing ${rel}`);
  }
  const config = JSON.parse(readFileSync(join(reqDir, 'config.json'), 'utf-8'));
  assert(config.mode === mode, `${reqDir}/config.json: expected mode ${mode}, got ${config.mode}`);
  assert(config.config_version === 2, `${reqDir}/config.json: config_version must be 2`);
  assert(config.risk_tier === 'auto', `${reqDir}/config.json: risk_tier must default to auto`);
  assert(!config.models?.roles, `${reqDir}/config.json: template must not shadow project models.roles`);
  const progress = readFileSync(join(reqDir, 'progress.md'), 'utf-8');
  assert(progress.includes('current_state: INIT'), `${reqDir}/progress.md: initial state must be INIT`);
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
  const fullRoles = ['repo-scout', 'planner', 'tech-lead', 'sa', 'qa', 'evaluator'];
  const fastRoles = ['fullstack', 'reviewer', 'verifier'];
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
    { next: 'HOTFIX_CANDIDATE_READY', action: 'assert_p3_candidate' },
    'hotfix P3 deterministic Review skip',
  );
  const hotfixGate = mod.nextStep({ state: 'HOTFIX_TEST_VERIFIED', enabledRoles: hotfixRoles, mode: 'hotfix' });
  expectStep(hotfixGate, { next: 'HOTFIX_RELEASE_PENDING_HUMAN', action: 'await_release_approval' }, 'hotfix Gateway B');
  assert(hotfixGate.stop === true, 'Hotfix release gate must stop for human approval');

  expectStep(
    mod.nextStep({ state: 'REQ_DRAFTED', enabledRoles: fullRoles, mode: 'full' }),
    { next: 'RECON_DONE', role: 'repo-scout', action: 'recon' },
    'full REQ_DRAFTED',
  );
  expectStep(
    mod.nextStep({ state: 'RECON_DONE', enabledRoles: fullRoles, mode: 'full' }),
    { next: 'SPEC_DRAFTED', role: 'planner', action: 'draft_spec' },
    'full RECON_DONE',
  );
  const fullKickoff = mod.nextStep({
    state: 'SPRINT_1_KICKOFF',
    enabledRoles: fullRoles,
    mode: 'full',
    sprint: { current: 1, total: 1 },
  });
  expectStep(fullKickoff, { next: 'SPRINT_1_DEV', role: 'tech-lead', action: 'implement' }, 'full sprint kickoff');
  assert(fullKickoff.parallel?.role === 'qa' && fullKickoff.parallel?.action === 'write_cases', 'full sprint kickoff must dispatch QA cases in parallel');
  expectStep(
    mod.nextStep({ state: 'ALL_SPRINTS_DONE', enabledRoles: fullRoles, mode: 'full' }),
    { next: 'FINAL_EVAL', role: 'evaluator', action: 'final_acceptance' },
    'full final eval',
  );

  expectStep(
    mod.nextStep({ state: 'REQ_DRAFTED', enabledRoles: fastRoles, mode: 'fast' }),
    { next: 'SPEC_DRAFTED', role: 'fullstack', action: 'draft_spec' },
    'fast REQ_DRAFTED',
  );
  expectStep(
    mod.nextStep({ state: 'SPEC_APPROVED', enabledRoles: fastRoles, mode: 'fast' }),
    { next: 'BUILD', role: 'fullstack', action: 'implement' },
    'fast SPEC_APPROVED',
  );
  expectStep(
    mod.nextStep({ state: 'BUILD', enabledRoles: fastRoles, mode: 'fast' }),
    { next: 'CODE_REVIEW', role: 'reviewer', action: 'review_code' },
    'fast BUILD → CODE_REVIEW',
  );
  expectStep(
    mod.nextStep({ state: 'DEPLOY_GATE', enabledRoles: fastRoles, mode: 'fast', workflow: { g2_enabled: true } }),
    { next: 'DEPLOY_GATE', role: null, action: 'await_deploy_approval' },
    'fast DEPLOY_GATE unapproved stops',
  );
  assert(
    mod.nextStep({ state: 'DEPLOY_GATE', enabledRoles: fastRoles, mode: 'fast', workflow: { g2_enabled: true } }).stop === true,
    'fast DEPLOY_GATE must stop when g2 not approved',
  );
  expectStep(
    mod.nextStep({ state: 'DEPLOY_GATE', enabledRoles: fastRoles, mode: 'fast', workflow: { g2_enabled: true, g2_approved: true } }),
    { next: 'TEST', role: 'verifier', action: 'verify_initial' },
    'fast DEPLOY_GATE approved → TEST',
  );
  expectStep(
    mod.nextStep({ state: 'DEPLOY_GATE', enabledRoles: fastRoles, mode: 'fast', workflow: { g2_enabled: false } }),
    { next: 'TEST', role: 'verifier', action: 'verify_initial' },
    'fast DEPLOY_GATE disabled → skip to TEST',
  );
  expectStep(
    mod.nextStep({ state: 'TEST_PASSED', enabledRoles: fastRoles, mode: 'fast' }),
    { next: 'ACCEPTANCE', role: 'reviewer', action: 'accept' },
    'fast TEST_PASSED → ACCEPTANCE',
  );
  const fastBreaker = mod.nextStep({
    state: 'FIX',
    enabledRoles: fastRoles,
    mode: 'fast',
    counters: { review_revision: 0, evaluator_reject: 0, fix_per_bug: { 'BUG-001': 2 } },
    thresholds: { review_revision: 2, evaluator_reject: 2, fix_per_bug: 2 },
  });
  expectStep(fastBreaker, { next: 'HUMAN_INTERVENTION', action: 'await_human' }, 'fast fix breaker');
  assert(fastBreaker.stop === true, 'fast fix breaker must stop for human intervention');
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

function writeHotfixArtifacts(reqDir) {
  const bugPath = join(reqDir, 'bugs', 'BUG-001.md');
  let bug = readFileSync(join(reqDir, 'bugs', 'BUG-template.md'), 'utf-8')
    .replaceAll('BUG-{序号}', 'BUG-001')
    .replaceAll('{短描述}', 'payment callback timeout');
  bug += '\n\n### Round 2 — 2026-06-03 — 结论: PASS\n\nSA light review appended in BUG file.\n';
  writeFileSync(bugPath, bug, 'utf-8');

  const qaDir = join(reqDir, 'qa-scripts');
  mkdirSync(qaDir, { recursive: true });
  writeFileSync(join(qaDir, 'BUG-001-repro.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf-8');

  writeFileSync(
    join(reqDir, 'acceptance.md'),
    readFileSync(join(reqDir, 'acceptance.md'), 'utf-8') +
      '\n\n## 线上缺陷修复 - BUG-001\n\n| AC-ID | 打分 |\n|---|---|\n| AC-001 | ✅ |\n\n**验收结果: 通过**\n',
    'utf-8',
  );
  writeFileSync(
    join(reqDir, 'test-cases.md'),
    readFileSync(join(reqDir, 'test-cases.md'), 'utf-8') +
      '\n\n## Hotfix Regression - BUG-001\n\n- 关联BUG: BUG-001\n- 关联契约: AC-001\n',
    'utf-8',
  );
  writeFileSync(
    join(reqDir, 'deploy.md'),
    readFileSync(join(reqDir, 'deploy.md'), 'utf-8') +
      '\n\n## 生产回滚步骤 - BUG-001\n\n1. rollback service\n2. verify callback\n',
    'utf-8',
  );
}

function assertHotfixLocations(reqDir) {
  const required = [
    'bugs/BUG-001.md',
    'qa-scripts/BUG-001-repro.sh',
    'acceptance.md',
    'test-cases.md',
    'deploy.md',
  ];
  for (const rel of required) {
    assert(existsSync(join(reqDir, rel)), `${reqDir}: missing hotfix artifact ${rel}`);
  }
  const bug = readFileSync(join(reqDir, 'bugs', 'BUG-001.md'), 'utf-8');
  assert(bug.includes('结论: PASS'), 'hotfix BUG file must contain appended SA light-review conclusion');
  assert(readFileSync(join(reqDir, 'acceptance.md'), 'utf-8').includes('线上缺陷修复 - BUG-001'), 'P0/P1 hotfix acceptance section missing');
  assert(readFileSync(join(reqDir, 'test-cases.md'), 'utf-8').includes('关联BUG: BUG-001'), 'P0/P1 hotfix regression case missing');
  assert(readFileSync(join(reqDir, 'deploy.md'), 'utf-8').includes('生产回滚步骤 - BUG-001'), 'P0/P1 hotfix rollback section missing');
  assert(!existsSync(join(repo, 'BUG-001.md')), 'hotfix BUG file must not be written at repo root');
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

  const fullReq = initFeature({ id: '01', slug: 'runtime-full', mode: 'full' });
  assertFeatureDocs(fullReq, 'full');
  assertNoWrongLocations('01', 'runtime-full');

  const fastReq = initFeature({ id: '02', slug: 'runtime-fast', mode: 'fast' });
  assertFeatureDocs(fastReq, 'fast');
  assertNoWrongLocations('02', 'runtime-fast');

  const leanReq = initLeanFeature({ id: '03', slug: 'runtime-lean' });
  assertLeanDocs(leanReq);
  assertNoWrongLocations('03', 'runtime-lean');

  const hotfixReq = initHotfixFeature({ id: '04', slug: 'runtime-hotfix' });
  assertHotfixDocs(hotfixReq);
  assertNoWrongLocations('04', 'runtime-hotfix');

  await assertStateMachine();
  await assertModelRouting();

  assertAllDocsGitAddOnlyFeatureDir('01', 'runtime-full');

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
    console.log('Runtime contract smoke passed: lean-default, standalone hotfix, full, and fast document/state semantics');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
