#!/usr/bin/env node
// Deterministic runtime contract smoke for cc-nexs document locations and mode semantics.
//
// This does not invoke an LLM. It proves the packaged templates, state-machine module,
// and hotfix document locations line up with the SOP that Codex mirror skills must follow.

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
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist', 'preset-nexs');
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
    { next: 'TEST', role: 'verifier', action: 'verify_initial' },
    'fast BUILD',
  );
  expectStep(
    mod.nextStep({ state: 'TEST_PASSED', enabledRoles: fastRoles, mode: 'fast' }),
    { next: 'ACCEPT', role: 'reviewer', action: 'review_and_accept' },
    'fast TEST_PASSED',
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

  await assertStateMachine();

  writeHotfixArtifacts(fullReq);
  assertHotfixLocations(fullReq);
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
    console.log('Runtime contract smoke passed: full, fast, hotfix document locations and state semantics');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
