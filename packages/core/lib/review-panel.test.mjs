import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractFindings, nativeReviewerModel, parseCliReviewerOutput, planCliReviewer, readReviewerResult,
  resolveReviewPanel, reviewSkills, runCliReviewer,
} from './review-panel.mjs';

test('the panel is exactly what is configured, and one native reviewer when nothing is', () => {
  assert.deepEqual(resolveReviewPanel(), [{ id: 'r1', executor: 'native' }]);
  assert.deepEqual(resolveReviewPanel({ panel: [{ executor: 'codex-cli', model: 'gpt-6-astra' }] }), [{ id: 'r1', executor: 'codex-cli', model: 'gpt-6-astra' }]);
  const three = resolveReviewPanel({ panel: [{ profile: 'review' }, { id: 'gpt', executor: 'codex-cli' }, { executor: 'dsh-cli', model: 'deepseek-official/deepseek-pro' }] });
  assert.deepEqual(three.map((item) => [item.id, item.executor]), [['r1', 'native'], ['gpt', 'codex-cli'], ['r3', 'dsh-cli']]);
  assert.throws(() => resolveReviewPanel({ panel: [] }), /at least one reviewer/);
  assert.throws(() => resolveReviewPanel({ panel: [{ executor: 'gemini-cli' }] }), /executor must be one of/);
  assert.throws(() => resolveReviewPanel({ panel: [{ id: 'a' }, { id: 'a' }] }), /duplicate review.panel id/);
  assert.throws(() => resolveReviewPanel({ panel: [{ id: 'Bad Id' }] }), /lowercase letters/);
  assert.throws(() => resolveReviewPanel({ panel: [{ executor: 'claude-cli', profile: 'review' }] }), /profile applies to native reviewers/);
  assert.throws(() => resolveReviewPanel({ panel: [{ executor: 'dsh-cli', model: 'deepseek-pro' }] }), /needs provider/);
  assert.throws(() => resolveReviewPanel({ panel: [{ timeout_seconds: 0 }] }), /positive integer/);
});

test('a native reviewer runs on its own model or profile, else on the role routing', () => {
  const models = { profiles: { escalated: { codex: { model: 'gpt-6-astra', effort: 'high' }, pi: { model: 'magpie/x', thinking: 'medium', fallback_models: ['y'] } } } };
  assert.equal(nativeReviewerModel({ id: 'r1' }, { runtime: 'codex', models }), null);
  assert.deepEqual(nativeReviewerModel({ id: 'r1', profile: 'escalated' }, { runtime: 'codex', models }), { model: 'gpt-6-astra', effort: 'high', source: 'profile escalated' });
  assert.deepEqual(nativeReviewerModel({ id: 'r1', profile: 'escalated' }, { runtime: 'pi', models }).fallback_models, ['y']);
  assert.deepEqual(nativeReviewerModel({ id: 'r1', model: 'sonnet' }, { runtime: 'claude', models }), { model: 'sonnet', effort: 'inherit', source: 'panel' });
  assert.throws(() => nativeReviewerModel({ id: 'r1', profile: 'nope' }, { runtime: 'claude', models }), /unknown model profile nope/);
});

test('each CLI reviewer gets a non-interactive argv; the brief stays in a file', () => {
  const options = { prompt: 'Read the brief', cwd: '/ws', runDir: '/ws/run' };
  const codex = planCliReviewer({ executor: 'codex-cli', model: 'gpt-6-astra', effort: 'high' }, options);
  assert.deepEqual(codex.args, ['exec', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="high"', '-s', 'workspace-write', '--ephemeral', '--skip-git-repo-check', '-C', '/ws', '-o', '/ws/run/last-message.txt', '-']);
  assert.equal(codex.stdin, 'Read the brief');
  const claude = planCliReviewer({ executor: 'claude-cli', model: 'opus' }, options);
  assert.equal(claude.executable, 'claude');
  assert.ok(claude.args.includes('--no-session-persistence') && claude.args.includes('Edit Write NotebookEdit'));
  const agy = planCliReviewer({ executor: 'agy-cli', model: 'gemini-4-argon-high' }, options);
  assert.equal(agy.args.at(-1), '--print=Read the brief', 'agy takes the prompt attached to --print, last');
  const pi = planCliReviewer({ executor: 'pi-cli', model: 'magpie/deepseek/deepseek-flash', effort: 'high' }, options);
  assert.deepEqual(pi.args.slice(-3), ['--model', 'magpie/deepseek/deepseek-flash:high', 'Read the brief']);
  const dsh = planCliReviewer({ executor: 'dsh-cli', model: 'deepseek-official/deepseek-pro' }, options);
  assert.deepEqual(dsh.args, ['--profile', 'headless', '--patch', '/ws/run/dsh.patch.yml', '-']);
  const patch = dsh.files['/ws/run/dsh.patch.yml'];
  assert.match(patch, /id: credentials\n {2}disabled: false/, 'dsh uses the signed-in account, not an API key');
  assert.match(patch, /provider: "deepseek-official"\n {4}model: "deepseek-pro"/);
  assert.doesNotMatch(planCliReviewer({ executor: 'dsh-cli' }, options).files['/ws/run/dsh.patch.yml'], /agent-default-model/);
  assert.throws(() => planCliReviewer({ executor: 'native' }, options), /not a CLI reviewer/);
});

test('findings are read from each CLI reply format, including a wrapped answer', () => {
  const findings = [{ id: 'F-1', severity: 'P2' }];
  assert.deepEqual(extractFindings(`Done.\n\`\`\`json\n${JSON.stringify({ findings })}\n\`\`\``), findings);
  const agy = JSON.stringify({ status: 'SUCCESS', response: `${JSON.stringify({ findings })}\n`, structured_output: { output: JSON.stringify({ findings }) } });
  assert.deepEqual(extractFindings(parseCliReviewerOutput('agy-cli', { stdout: agy }).text), findings);
  const claude = parseCliReviewerOutput('claude-cli', { stdout: JSON.stringify({ type: 'result', result: JSON.stringify({ findings: [] }), modelUsage: { 'claude-opus-5-5': {} } }) });
  assert.deepEqual([extractFindings(claude.text), claude.model], [[], 'claude-opus-5-5']);
  const codex = parseCliReviewerOutput('codex-cli', { stdout: 'ignored', stderr: 'workdir: /ws\nmodel: fixture-model\n', lastMessage: '{"findings":[]}' });
  assert.deepEqual([extractFindings(codex.text), codex.model], [[], 'fixture-model']);
  assert.throws(() => extractFindings('I found nothing worth reporting.'), /no JSON object with a findings array/);
});

test('a CLI reviewer stores its findings, and is discarded when it touches the candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-review-panel-'));
  try {
    const repo = join(root, 'web');
    mkdirSync(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a');
    const brief = join(root, 'brief.md');
    writeFileSync(brief, 'Break this change.');
    const source = { web: git('rev-parse', 'HEAD').trim() };
    const base = { workspaceRoot: root, featureId: '40', round: 'consolidated', briefFile: brief, source, worktrees: { web: repo } };
    const reviewer = { id: 'r2', executor: 'codex-cli', model: 'gpt-6-astra' };
    let seen;
    const ok = (command, args, options) => {
      seen = { command, args, input: options.input };
      writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({ findings: [{ id: 'F-1' }] }));
      return { status: 0, stdout: '', stderr: 'model: fixture-model-2026\n' };
    };
    const { record } = runCliReviewer({ ...base, reviewer, spawn: ok });
    assert.equal(seen.command, 'codex');
    assert.match(seen.input, /Read the review brief at .*brief\.md/);
    assert.deepEqual([record.model, record.findings.length], ['fixture-model-2026', 1], 'the model the CLI reports wins over the configured one');
    assert.equal(readReviewerResult({ workspaceRoot: root, featureId: '40', round: 'consolidated', reviewerId: 'r2' }).fingerprint, record.fingerprint);

    const touches = () => { writeFileSync(join(repo, 'a.txt'), 'edited\n'); return { status: 0, stdout: '{"findings":[]}' }; };
    assert.throws(() => runCliReviewer({ ...base, round: 'closure', reviewer: { id: 'r3', executor: 'pi-cli' }, spawn: touches }), /changed candidate worktree\(s\) web; its findings were discarded/);
    assert.equal(readReviewerResult({ workspaceRoot: root, featureId: '40', round: 'closure', reviewerId: 'r3' }), null);
    git('checkout', '--', 'a.txt');

    assert.throws(() => runCliReviewer({ ...base, reviewer: { id: 'r4', executor: 'agy-cli' }, spawn: () => ({ status: 2, stdout: '', stderr: 'boom' }) }), /exited with 2/);
    assert.match(readFileSync(join(root, '.cc-nexs/runtime/tasks/40/review/consolidated/r4/stderr.txt'), 'utf8'), /boom/);
    assert.throws(() => runCliReviewer({ ...base, reviewer: { id: 'r1', executor: 'native' } }), /native reviewer; dispatch it as a subagent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('review skills resolve to skill files under the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-nexs-review-skills-'));
  try {
    mkdirSync(join(root, 'skills', 'api-contracts'), { recursive: true });
    writeFileSync(join(root, 'skills', 'api-contracts', 'SKILL.md'), '# API contracts');
    writeFileSync(join(root, 'checklist.md'), '# checklist');
    assert.deepEqual(reviewSkills({ skills: ['skills/api-contracts', 'checklist.md'] }, root), [join(root, 'skills/api-contracts/SKILL.md'), join(root, 'checklist.md')]);
    assert.deepEqual(reviewSkills({}, root), []);
    assert.throws(() => reviewSkills({ skills: ['missing'] }, root), /review skill not found: missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
