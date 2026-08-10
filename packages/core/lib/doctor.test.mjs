import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createProgressV2, writeProgressV2 } from './progress-v2.mjs';
import { planApprovalBinding } from './plan-contract.mjs';

const doctor = join(dirname(fileURLToPath(import.meta.url)), 'doctor.mjs');

function gitInit(path) {
  mkdirSync(path, { recursive: true });
  execFileSync('git', ['-C', path, 'init', '-q']);
}

function fixture({ complete = false, plaintext = false, host = 'test.example.com' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-doctor-'));
  const preset = join(root, 'preset');
  gitInit(join(root, 'docs'));
  gitInit(join(root, 'code'));
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  mkdirSync(preset, { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.json'), `${JSON.stringify({
    version: 1,
    docs_repository: 'docs',
    repositories: [
      { id: 'docs', path: 'docs', base_branch: 'main', docs: true },
      { id: 'code', path: 'code', base_branch: 'main', ...(complete && { test_branch: 'test' }) },
    ],
  })}\n`);
  writeFileSync(join(preset, 'preset.json'), `${JSON.stringify({
    name: 'doctor-fixture',
    workflow: { test_release: { policy: 'auto_if_ready' } },
    release: {
      test: {
        environment: 'test',
        browser: {
          required: true,
          claude_provider: 'chrome-devtools-mcp',
          codex_provider: 'current-browser-session',
          pi_provider: '@injaneity/pi-computer-use@0.4.3',
        },
      },
    },
  })}\n`);
  const project = {
    preset_path: 'preset',
    ...(plaintext && { credentials: { password: 'do-not-store-this' } }),
    ...(complete && {
      release: {
        test: {
          environment: 'test',
          app_url: `https://${host}`,
          operations_url: `https://${host}`,
          allowed_hosts: [host],
          driver: { command: 'node', args: ['driver.mjs'] },
        },
      },
    }),
  };
  writeFileSync(join(root, 'cc-nexs.config.json'), `${JSON.stringify(project)}\n`);
  return root;
}

function runDoctor(root, strict = false) {
  return spawnSync(process.execPath, [doctor, root, ...(strict ? ['--release-test'] : [])], { encoding: 'utf8' });
}

test('doctor warns in normal mode but fails strict release readiness', () => {
  const root = fixture();
  try {
    const normal = runDoctor(root);
    assert.equal(normal.status, 0);
    assert.match(normal.stderr, /missing test_branch/);
    const strict = runDoctor(root, true);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /missing test_branch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor rejects plaintext credentials even outside strict mode', () => {
  const root = fixture({ plaintext: true });
  try {
    const result = runDoctor(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /plaintext credential field is forbidden/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor strict mode blocks production-like test hosts', () => {
  const root = fixture({ complete: true, host: 'prod.example.com' });
  try {
    const result = runDoctor(root, true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /production-like host is forbidden/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor reports legacy feature routing without mutating config', () => {
  const root = fixture();
  const feature = join(root, 'docs', 'doc', '07.routing');
  mkdirSync(feature, { recursive: true });
  const configFile = join(feature, 'config.json');
  writeFileSync(configFile, `${JSON.stringify({
    mode: 'lean',
    models: { roles: {
      'lean-planner': 'balanced',
      'lean-developer': 'balanced',
      'lean-reviewer': 'review',
      'lean-verifier': 'balanced',
    } },
  }, null, 2)}\n`);
  writeProgressV2(join(feature, 'progress.json'), createProgressV2({
    featureId: '07', featureSlug: 'routing', preset: 'preset-standard', mode: 'lean',
  }));
  const before = digestFile(configFile);
  try {
    const result = runDoctor(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /migrate-feature-config 07/);
    assert.match(result.stderr, /blocks project routing/);
    assert.equal(digestFile(configFile), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor rejects non-canonical v2 risk tiers', () => {
  const root = fixture();
  const feature = join(root, 'docs', 'doc', '08.routing');
  mkdirSync(feature, { recursive: true });
  writeFileSync(join(feature, 'config.json'), `${JSON.stringify({
    config_version: 2,
    mode: 'lean',
    risk_tier: '高',
  }, null, 2)}\n`);
  writeProgressV2(join(feature, 'progress.json'), createProgressV2({
    featureId: '08', featureSlug: 'routing', preset: 'preset-standard', mode: 'lean',
  }));
  try {
    const result = runDoctor(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /risk_tier must use canonical/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor reports a hash-verifiable legacy Gateway A risk without mutating approval state', () => {
  const root = fixture();
  const feature = join(root, 'docs', 'doc', '09.routing');
  mkdirSync(feature, { recursive: true });
  const configFile = join(feature, 'config.json');
  const progressFile = join(feature, 'progress.json');
  writeFileSync(configFile, `${JSON.stringify({
    config_version: 2,
    mode: 'lean',
    risk_tier: 'auto',
  }, null, 2)}\n`);
  writeFileSync(join(feature, 'requirements.md'), '# Requirements\n');
  writeFileSync(join(feature, 'plan.md'), '# Plan\n\n<!-- APPROVAL-SCOPE START -->\n- risk_tier: high\n<!-- APPROVAL-SCOPE END -->\n');
  const progress = createProgressV2({
    featureId: '09', featureSlug: 'routing', preset: 'preset-standard', mode: 'lean',
  });
  const binding = planApprovalBinding(feature);
  delete binding.risk_tier;
  progress.gates.plan = { approved: true, binding };
  writeProgressV2(progressFile, progress);
  const configBefore = digestFile(configFile);
  const progressBefore = digestFile(progressFile);
  try {
    const result = runDoctor(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /legacy Gateway A risk high is hash-verified/);
    assert.match(result.stderr, /--bind-plan-risk/);
    assert.equal(digestFile(configFile), configBefore);
    assert.equal(digestFile(progressFile), progressBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function digestFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
