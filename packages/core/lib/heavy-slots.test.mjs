import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireHeavySlot, heavyEnv, heavySettings, runHeavy } from './heavy-slots.mjs';

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-heavy-'));
  mkdirSync(join(root, '.cc-nexs'), { recursive: true });
  writeFileSync(join(root, '.cc-nexs', 'workspace.yml'), 'version: 1\nrepositories:\n  - id: web\n    path: web\n');
  return root;
}

test('heavy commands queue for a workspace slot instead of running all at once', () => {
  const root = workspace();
  try {
    const first = acquireHeavySlot({ root, slots: 1, label: 'pnpm build (task 377)', waitMs: 60000 });
    let polls = 0;
    const second = acquireHeavySlot({ root, slots: 1, label: 'mvn test (task 380)', waitMs: 60000, sleep: () => { polls += 1; first.release(); } });
    assert.equal(polls, 1, 'the second command waited for the first to finish');
    assert.equal(second.slot, 1);
    let clock = 0;
    assert.throws(() => acquireHeavySlot({ root, slots: 1, label: 'next build', waitMs: 10000, now: () => clock, sleep: () => { clock += 5000; } }),
      /no heavy slot freed within 0 minutes; running: mvn test \(task 380\)/);
    second.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a slot left by a process that died is reclaimed', () => {
  const root = workspace();
  try {
    const slot = join(root, '.cc-nexs', 'runtime', 'heavy', 'slot-1');
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 12345, hostname: hostname(), label: 'crashed build' }));
    const acquired = acquireHeavySlot({ root, slots: 1, label: 'next build', waitMs: 1000, sleep: () => assert.fail('a dead owner must not make it wait') });
    assert.equal(acquired.slot, 1);
    acquired.release();
    assert.equal(existsSync(slot), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('heavy processes get a memory cap unless the caller set one', () => {
  const settings = heavySettings({});
  assert.deepEqual(heavyEnv({}, settings), { NODE_OPTIONS: '--max-old-space-size=4096', MAVEN_OPTS: '-Xmx2g' });
  assert.deepEqual(heavyEnv({ NODE_OPTIONS: '--max-old-space-size=8192', MAVEN_OPTS: '-Xmx6g -Dx=1' }, settings),
    { NODE_OPTIONS: '--max-old-space-size=8192', MAVEN_OPTS: '-Xmx6g -Dx=1' });
  assert.equal(heavyEnv({ NODE_OPTIONS: '--enable-source-maps' }, settings).NODE_OPTIONS, '--enable-source-maps --max-old-space-size=4096');
  assert.throws(() => heavySettings({ mergedWorkflow: { local_verify: { heavy: { slots: 0 } } } }), /slots must be a positive integer/);
});

test('heavy runs the command in a slot, passes its exit status through, and frees the slot', () => {
  const root = workspace();
  try {
    let seen;
    const result = runHeavy({ cwd: root, command: ['pnpm', 'build'], env: { PATH: process.env.PATH }, spawn: (command, args, options) => {
      seen = { command, args, cap: options.env.NODE_OPTIONS, held: readdirSync(join(root, '.cc-nexs', 'runtime', 'heavy')) };
      return { status: 3 };
    } });
    assert.equal(result.status, 3);
    assert.deepEqual(seen.held, ['slot-1']);
    assert.equal(seen.cap, '--max-old-space-size=4096');
    assert.deepEqual(readdirSync(join(root, '.cc-nexs', 'runtime', 'heavy')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
