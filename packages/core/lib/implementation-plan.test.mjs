import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertImplementationApprovalCurrent,
  implementationApprovalBinding,
  implementationWaves,
  parseImplementationOwnership,
} from './implementation-plan.mjs';

function spec(rows) {
  return `# Spec
| AC-ID | Given | When | Then | 所属 Sprint |
|---|---|---|---|---|
| AC-001 | a | b | c | M1 |
| AC-002 | a | b | c | M1 |
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
<!-- IMPLEMENTATION-OWNERSHIP:END -->`;
}

test('multi-end ownership is grouped into bounded parallel waves', () => {
  const parsed = parseImplementationOwnership(spec([
    '| IMP-backend | M1 | backend | AC-001, AC-002 | backend-java | src/main/java/upload/** | - | backend unit | 1 |',
    '| IMP-web | M1 | web | AC-001 | web | src/features/upload/** | - | web unit | 1 |',
    '| IMP-contract | M1 | integration | AC-002 | web | src/api/upload.ts | IMP-backend, IMP-web | typecheck | 2 |',
  ]), { sprint: 'M1', repositories: ['backend-java', 'web'] });
  assert.equal(parsed.contractVersion, 1);
  assert.deepEqual(implementationWaves(parsed.assignments, { maxParallel: 2 }).map((wave) => (
    wave.batches.map((batch) => batch.map((item) => item.id))
  )), [[['IMP-backend', 'IMP-web']], [['IMP-contract']]]);
});

test('legacy spec without ownership remains a single-worker compatibility path', () => {
  assert.deepEqual(parseImplementationOwnership('# legacy'), { contractVersion: 0, assignments: [] });
});

test('same assigned repository is serialized even when paths appear disjoint', () => {
  assert.throws(() => parseImplementationOwnership(spec([
    '| IMP-a | M1 | backend | AC-001 | api | src/service/** | - | unit | 1 |',
    '| IMP-b | M1 | backend | AC-002 | api | src/controller/** | - | unit | 1 |',
  ])), /share repository api/);
});

test('dependencies must point to an earlier wave in the same sprint', () => {
  assert.throws(() => parseImplementationOwnership(spec([
    '| IMP-a | M1 | backend | AC-001 | api | src/a/** | IMP-b | unit | 1 |',
    '| IMP-b | M1 | web | AC-002 | web | src/b/** | - | unit | 1 |',
  ])), /must be in an earlier wave/);
});

test('unknown repositories, escaping paths, and missing AC coverage fail closed', () => {
  assert.throws(() => parseImplementationOwnership(spec([
    '| IMP-a | M1 | backend | AC-001, AC-002 | missing | src/a/** | - | unit | 1 |',
  ]), { repositories: ['api'] }), /unknown repository missing/);
  assert.throws(() => parseImplementationOwnership(spec([
    '| IMP-a | M1 | backend | AC-001, AC-002 | api | ../src/** | - | unit | 1 |',
  ]), { repositories: ['api'] }), /escapes its repository/);
  assert.throws(() => parseImplementationOwnership(spec([
    '| IMP-a | M1 | backend | AC-001 | api | src/a/** | - | unit | 1 |',
  ]), { repositories: ['api'] }), /does not cover acceptance criteria: AC-002/);
});

test('ownership requires exactly one marker pair', () => {
  const valid = spec([
    '| IMP-a | M1 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |',
  ]);
  assert.throws(() => parseImplementationOwnership(`${valid}\n${valid}`), /exactly one ordered marker pair/);
});

test('G1 binding rejects ownership or approved spec scope drift but ignores the change log', () => {
  const original = `${spec([
    '| IMP-api | M1 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |',
  ])}\n\n## 变更记录\n\n| 日期 | 变更内容 | 操作人 |\n|---|---|---|\n| initial | initial | planner |`;
  const progress = {
    state: 'SPEC_APPROVED', sprint: { current: 1, total: 1 },
    gates: { g1: { approved: true, binding: implementationApprovalBinding(original, { repositories: ['api'] }) } },
  };
  assert.equal(assertImplementationApprovalCurrent(progress, `${original}\n| approval | approved | human |`, { repositories: ['api'] }).legacy, false);
  assert.throws(() => assertImplementationApprovalCurrent(progress, original.replace('src/a/**', 'src/b/**'), {
    repositories: ['api'],
  }), /changed after G1/);
});

test('Fast and legacy lite reject assignments outside M1', () => {
  const fastSpec = spec([
    '| IMP-api | M2 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |',
  ]);
  assert.throws(() => parseImplementationOwnership(fastSpec, { repositories: ['api'], mode: 'fast' }), /must belong to M1/);
  assert.throws(() => parseImplementationOwnership(fastSpec, { repositories: ['api'], mode: 'lite' }), /must belong to M1/);
});

test('change-log placement cannot hide normative spec drift', () => {
  const misplaced = `${spec([
    '| IMP-api | M1 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |',
  ])}\n\n## 变更记录\n\n| 日期 | 变更内容 | 操作人 |\n|---|---|---|\n\n## Hidden requirements\n\nMust do something else.`;
  assert.throws(() => implementationApprovalBinding(misplaced, { repositories: ['api'] }), /final H2 section/);
});

test('assignment ACs must remain in their declared sprint', () => {
  const multiSprint = `# Spec
| AC-ID | Given | When | Then | 所属 Sprint |
|---|---|---|---|---|
| AC-001 | a | b | c | M1 |
| AC-002 | a | b | c | M2 |
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-api | M1 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->`;
  assert.throws(() => parseImplementationOwnership(multiSprint, { repositories: ['api'] }), /AC-002.*belongs to M2/);
});

test('official related-sprint header is enforced and empty sprint cells fail closed', () => {
  const relatedSprint = `# Spec
| AC-ID | Given | When | Then | 关联 Sprint |
|---|---|---|---|---|
| AC-001 | a | b | c | M1 |
| AC-002 | a | b | c | M2 |
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-api | M1 | backend | AC-001 | api | src/a/** | - | unit | 1 |
| IMP-web | M1 | web | AC-002 | web | src/b/** | - | unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->`;
  assert.throws(() => parseImplementationOwnership(relatedSprint, {
    repositories: ['api', 'web'], mode: 'full',
  }), /AC-002.*belongs to M2/);
  assert.throws(() => parseImplementationOwnership(relatedSprint.replace('| M2 |', '| |'), {
    repositories: ['api', 'web'], mode: 'full',
  }), /explicit Sprint.*AC-002/);
});

test('historical approval cannot silently adopt a present ownership contract', () => {
  const current = spec([
    '| IMP-api | M1 | backend | AC-001, AC-002 | api | ../src/** | - | unit | 1 |',
  ]);
  assert.throws(() => assertImplementationApprovalCurrent({ gates: { g1: { approved: true } } }, current, {
    repositories: ['api'],
  }), /escapes its repository/);
});

test('Full derives and binds one contiguous Sprint contract from AC ownership', () => {
  const fullSpec = `# Spec
| AC-ID | Given | When | Then | 所属 Sprint |
|---|---|---|---|---|
| AC-001 | a | b | c | M1 |
| AC-002 | a | b | c | M2 |
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-api | M1 | backend | AC-001 | api | src/a/** | - | unit | 1 |
| IMP-web | M2 | web | AC-002 | web | src/b/** | - | unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->`;
  const parsed = parseImplementationOwnership(fullSpec, { repositories: ['api', 'web'], mode: 'full' });
  assert.deepEqual(parsed.sprints, ['M1', 'M2']);
  assert.equal(parsed.sprintTotal, 2);
  const binding = implementationApprovalBinding(fullSpec, { repositories: ['api', 'web'], mode: 'full' });
  assert.equal(binding.sprint_contract_version, 1);
  assert.deepEqual(binding.sprints, ['M1', 'M2']);
  assert.equal(binding.sprint_total, 2);
});

test('Full rejects a non-contiguous M1..MN Sprint contract', () => {
  const missingM2 = `# Spec
| AC-ID | Given | When | Then | 所属 Sprint |
|---|---|---|---|---|
| AC-001 | a | b | c | M1 |
| AC-003 | a | b | c | M3 |
<!-- IMPLEMENTATION-OWNERSHIP:START -->
| Assignment | Sprint | Surface | AC | Repository | Allowed paths | Depends on | Validation | Wave |
|---|---|---|---|---|---|---|---|---|
| IMP-api | M1 | backend | AC-001 | api | src/a/** | - | unit | 1 |
| IMP-web | M3 | web | AC-003 | web | src/b/** | - | unit | 1 |
<!-- IMPLEMENTATION-OWNERSHIP:END -->`;
  assert.throws(() => parseImplementationOwnership(missingM2, {
    repositories: ['api', 'web'], mode: 'full',
  }), /contiguous from M1.*M1, M3/);
});

test('runtime rejects progress total/current drift from the approved Sprint binding', () => {
  const original = spec([
    '| IMP-api | M1 | backend | AC-001, AC-002 | api | src/a/** | - | unit | 1 |',
  ]);
  const binding = implementationApprovalBinding(original, { repositories: ['api'], mode: 'fast' });
  const progress = {
    mode: 'fast', state: 'SPEC_APPROVED', sprint: { current: 1, total: 2 },
    gates: { g1: { approved: true, binding } },
  };
  assert.throws(() => assertImplementationApprovalCurrent(progress, original, {
    repositories: ['api'], mode: 'fast',
  }), /Sprint state drifted/);
  progress.sprint = { current: 1, total: 1 };
  progress.state = 'SPRINT_2_DEV';
  assert.throws(() => assertImplementationApprovalCurrent(progress, original, {
    repositories: ['api'], mode: 'fast',
  }), /does not match state/);
});
