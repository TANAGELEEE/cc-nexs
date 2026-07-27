import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
