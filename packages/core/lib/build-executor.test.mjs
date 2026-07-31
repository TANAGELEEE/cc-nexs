import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { executeBuildPlan } from './build-executor.mjs';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('build executor runs independent changed modules in parallel and reuses exact-candidate successes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-build-executor-'));
  const cacheRoot = mkdtempSync(join(tmpdir(), 'cc-nexs-build-cache-'));
  try {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'Test User']);
    git(root, ['config', 'user.email', 'test@example.com']);
    mkdirSync(join(root, 'api'));
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, 'api', 'app.txt'), 'base\n');
    writeFileSync(join(root, 'web', 'app.txt'), 'base\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
    git(root, ['branch', 'feature/test']);
    git(root, ['switch', 'feature/test']);
    writeFileSync(join(root, 'api', 'app.txt'), 'changed\n');
    writeFileSync(join(root, 'web', 'app.txt'), 'changed\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'feature']);

    const mergedStack = {
      diff_base: 'main',
      build_cache: true,
      build_max_parallel: 2,
      modules: [
        { name: 'api', match: ['api/**'], build_cmd: 'build-api', test_cmd: '' },
        { name: 'web', match: ['web/**'], build_cmd: 'build-web', test_cmd: '' },
      ],
    };
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const runner = async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      active -= 1;
      return 0;
    };
    const first = await executeBuildPlan({ cwd: root, mergedStack, phase: 'build', cacheRoot, runner });
    assert.equal(calls, 2);
    assert.equal(maxActive, 2);
    assert.deepEqual(first.results.map((item) => item.status), ['passed', 'passed']);

    const second = await executeBuildPlan({ cwd: root, mergedStack, phase: 'build', cacheRoot, runner });
    assert.equal(calls, 2);
    assert.deepEqual(second.results.map((item) => item.status), ['cached', 'cached']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test('build executor preserves configured fallback commands', async () => {
  const order = [];
  const mergedStack = {
    diff_base: 'main',
    build_cache: false,
    build_max_parallel: 4,
    build_cmd: 'fallback-build',
    test_cmd: '',
    modules: [],
  };
  const result = await executeBuildPlan({
    cwd: process.cwd(),
    mergedStack,
    phase: 'build',
    useCache: false,
    runner: async ({ module }) => { order.push(module); return 0; },
  });
  assert.deepEqual(order, ['fallback']);
  assert.equal(result.results[0].status, 'passed');
});

test('build executor waits for declared dependencies before starting a downstream module', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-build-dag-'));
  try {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.name', 'Test User']);
    git(root, ['config', 'user.email', 'test@example.com']);
    for (const directory of ['api', 'web', 'e2e']) {
      mkdirSync(join(root, directory));
      writeFileSync(join(root, directory, 'app.txt'), 'base\n');
    }
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
    git(root, ['switch', '-c', 'feature/dag']);
    writeFileSync(join(root, 'e2e', 'app.txt'), 'changed\n');
    git(root, ['add', 'e2e/app.txt']);
    git(root, ['commit', '-m', 'feature']);

    const events = [];
    const result = await executeBuildPlan({
      cwd: root,
      phase: 'build',
      useCache: false,
      mergedStack: {
        diff_base: 'main',
        build_cache: false,
        build_max_parallel: 2,
        modules: [
          { name: 'api', match: ['api/**'], build_cmd: 'build-api' },
          { name: 'web', match: ['web/**'], build_cmd: 'build-web' },
          { name: 'e2e', match: ['e2e/**'], build_cmd: 'build-e2e', depends_on: ['api', 'web'] },
        ],
      },
      runner: async ({ module }) => {
        events.push(`${module}:start`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
        events.push(`${module}:end`);
        return 0;
      },
    });
    const e2eStart = events.indexOf('e2e:start');
    assert.deepEqual(result.matched_modules, ['e2e']);
    assert.deepEqual(result.selected_modules, ['api', 'web', 'e2e']);
    assert.ok(e2eStart > events.indexOf('api:end'));
    assert.ok(e2eStart > events.indexOf('web:end'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
