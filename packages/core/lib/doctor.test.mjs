import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function fixture({
  complete = false,
  plaintext = false,
  host = 'test.example.com',
  piProvider = 'ego-lite',
  piFallbackProvider = '@injaneity/pi-computer-use@0.4.3',
  piFallbackHeadless = true,
} = {}) {
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
          pi_provider: piProvider,
          pi_fallback: {
            provider: piFallbackProvider,
            headless: piFallbackHeadless,
          },
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

function runDoctor(root, strict = false, env = {}, feature = null) {
  return spawnSync(process.execPath, [doctor, root, ...(strict ? ['--release-test'] : []), ...(feature ? ['--feature', feature] : [])], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('release doctor scopes feature artifacts without hiding workspace safety', () => {
  const root = fixture({ complete: true });
  const target = join(root, 'docs', 'doc', '09.target');
  const unrelated = join(root, 'docs', 'doc', '10.stale');
  mkdirSync(target, { recursive: true });
  mkdirSync(unrelated, { recursive: true });
  writeProgressV2(join(target, 'progress.json'), createProgressV2({
    featureId: '09', featureSlug: 'target', preset: 'preset-standard', mode: 'lean',
  }));
  writeFileSync(join(unrelated, 'progress.json'), '{ definitely not valid JSON\n');
  try {
    const global = runDoctor(root, true);
    assert.equal(global.status, 1);
    assert.match(global.stderr, /10\.stale/);

    const scoped = runDoctor(root, true, {}, '09');
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.doesNotMatch(scoped.stderr, /10\.stale/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function installFakeCommand(root, command, output) {
  const bin = join(root, 'bin');
  const executable = join(bin, command);
  mkdirSync(bin, { recursive: true });
  writeFileSync(executable, `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${output}'\n`);
  chmodSync(executable, 0o755);
  return bin;
}

test('doctor warns in normal mode but fails strict release readiness', () => {
  const root = fixture();
  try {
    const normal = runDoctor(root);
    assert.equal(normal.status, 0);
    assert.match(normal.stderr, /has no test_branch; Lean may use it locally only/);
    const strict = runDoctor(root, true);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /at least one code repository with test_branch/);
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

    writeFileSync(join(root, 'cc-nexs.config.json'), `${JSON.stringify({
      preset_path: 'preset',
      credentials: { api_key_env: 'TEST_API_KEY', credential_ref: 'keychain://test/key' },
    })}\n`);
    const references = runDoctor(root);
    assert.equal(references.status, 0, references.stderr);

    writeFileSync(join(root, 'cc-nexs.config.json'), `${JSON.stringify({
      preset_path: 'preset',
      release: { test: { secret_access_key: 'literal-secret' } },
    })}\n`);
    const accessKey = runDoctor(root);
    assert.equal(accessKey.status, 1);
    assert.match(accessKey.stderr, /secret_access_key/);
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

test('doctor only accepts ego-lite as the Pi browser provider', () => {
  const root = fixture({ complete: true, piProvider: 'unsupported-provider' });
  try {
    const result = runDoctor(root, true);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /pi_provider must be ego-lite/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor requires the pinned headless Pi fallback contract', () => {
  const wrongProvider = fixture({ complete: true, piFallbackProvider: 'unsupported-provider' });
  const notHeadless = fixture({ complete: true, piFallbackHeadless: false });
  try {
    const providerResult = runDoctor(wrongProvider, true);
    assert.equal(providerResult.status, 0, providerResult.stderr);
    assert.match(providerResult.stderr, /pi_fallback\.provider must be @injaneity\/pi-computer-use@0\.4\.3/);

    const headlessResult = runDoctor(notHeadless, true);
    assert.equal(headlessResult.status, 0, headlessResult.stderr);
    assert.match(headlessResult.stderr, /pi_fallback\.headless must be true/);
  } finally {
    rmSync(wrongProvider, { recursive: true, force: true });
    rmSync(notHeadless, { recursive: true, force: true });
  }
});

test('doctor probes the ego lite runtime for Pi release readiness', () => {
  const root = fixture({ complete: true });
  try {
    const readyBin = installFakeCommand(root, 'ego-browser', 'ego-browser ready');
    const ready = runDoctor(root, true, {
      CC_NEXS_RUNTIME: 'pi',
      PATH: `${readyBin}:${process.env.PATH || ''}`,
    });
    assert.equal(ready.status, 0, ready.stderr);

    installFakeCommand(root, 'ego-browser', 'not ready');
    installFakeCommand(root, 'pi', 'npm:pi-subagents@0.35.1');
    const unavailable = runDoctor(root, true, {
      CC_NEXS_RUNTIME: 'pi',
      HOME: root,
      PATH: `${readyBin}:${process.env.PATH || ''}`,
    });
    assert.equal(unavailable.status, 0, unavailable.stderr);
    assert.match(unavailable.stderr, /pi-computer-use@0\.4\.3 is not installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('doctor falls back to computer-use only with effective headless=true', () => {
  const root = fixture({ complete: true });
  try {
    const bin = installFakeCommand(root, 'ego-browser', 'not ready');
    installFakeCommand(root, 'pi', 'git:github.com/injaneity/pi-computer-use@v0.4.3');
    mkdirSync(join(root, '.pi'), { recursive: true });
    writeFileSync(join(root, '.pi', 'computer-use.json'), `${JSON.stringify({ browser_use: true, headless: true })}\n`);

    const ready = runDoctor(root, true, {
      CC_NEXS_RUNTIME: 'pi',
      HOME: root,
      PATH: `${bin}:${process.env.PATH || ''}`,
    });
    assert.equal(ready.status, 0, ready.stderr);
    assert.match(ready.stderr, /will use @injaneity\/pi-computer-use@0\.4\.3 with headless=true/);

    const unsafe = runDoctor(root, true, {
      CC_NEXS_RUNTIME: 'pi',
      HOME: root,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PI_COMPUTER_USE_HEADLESS: '0',
    });
    assert.equal(unsafe.status, 0, unsafe.stderr);
    assert.match(unsafe.stderr, /pi-computer-use headless must be true/);
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
