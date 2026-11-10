// Review panel: every reviewer runs the same brief on the same exact candidate.
//
// `review.panel` lists the reviewers; one entry means one reviewer, several mean
// several, and nothing configured means one native reviewer on the role's routing.
// The list applies to every runtime, or `review.panel.<claude|codex|pi>` gives each
// runtime its own list (a runtime without one gets the default).
// A native reviewer is a subagent of the host runtime (its model from a profile or
// an explicit model). A CLI reviewer runs another agent CLI non-interactively, so a
// Claude Code or Codex host can include another vendor's model:
//
//   codex-cli   codex exec            claude-cli  claude -p
//   agy-cli     agy --print           pi-cli      pi -p
//   dsh-cli     dsh --profile <p> -   (model through a generated profile patch)
//
// Each reviewer's findings are stored per round and candidate under the task's
// runtime directory; record-review checks that every panel member reported.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCandidateContext } from './candidate-context.mjs';
import { candidateFingerprint } from './progress-v2.mjs';
import { assertReviewRequired } from './review-policy.mjs';
import { detectRuntime } from './runtime-resolver.mjs';
import { taskFilesDir } from './verify-artifacts.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REVIEWER_EXECUTORS = new Set(['native', 'codex-cli', 'claude-cli', 'agy-cli', 'dsh-cli', 'pi-cli']);
export const REVIEW_ROUNDS = new Set(['consolidated', 'closure', 'gateway-b-delta']);
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RUNTIMES = new Set(['claude', 'codex', 'pi']);
const DEFAULT_TIMEOUT_SECONDS = 1800;

function panelEntries(panel, runtime) {
  if (panel === undefined || Array.isArray(panel)) return panel;
  if (!panel || typeof panel !== 'object') throw new Error('[cc-nexs] review.panel must be a list, or a map of claude/codex/pi lists');
  const unknown = Object.keys(panel).filter((key) => !RUNTIMES.has(key));
  if (unknown.length) throw new Error(`[cc-nexs] review.panel keys must be claude, codex, or pi: ${unknown.join(', ')}`);
  if (!RUNTIMES.has(runtime)) throw new Error(`[cc-nexs] review.panel is set per runtime; name the runtime (claude, codex, or pi), got ${runtime || '(none)'}`);
  return panel[runtime];
}

export function resolveReviewPanel(review = {}, runtime = detectRuntime()) {
  const configured = panelEntries(review.panel, runtime);
  const entries = configured === undefined ? [{ id: 'r1', executor: 'native' }] : configured;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('[cc-nexs] review.panel must list at least one reviewer');
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('[cc-nexs] each review.panel entry must be an object');
    const reviewer = { ...entry, id: entry.id ?? `r${index + 1}`, executor: entry.executor ?? 'native' };
    if (reviewer.timeout_seconds !== undefined && !(Number.isInteger(reviewer.timeout_seconds) && reviewer.timeout_seconds > 0)) {
      throw new Error(`[cc-nexs] review.panel ${reviewer.id} timeout_seconds must be a positive integer`);
    }
    if (!ID.test(reviewer.id)) throw new Error(`[cc-nexs] review.panel id must be lowercase letters, digits, and dashes: ${reviewer.id}`);
    if (seen.has(reviewer.id)) throw new Error(`[cc-nexs] duplicate review.panel id: ${reviewer.id}`);
    seen.add(reviewer.id);
    if (!REVIEWER_EXECUTORS.has(reviewer.executor)) {
      throw new Error(`[cc-nexs] review.panel ${reviewer.id} executor must be one of ${[...REVIEWER_EXECUTORS].join(', ')}`);
    }
    for (const field of ['profile', 'model', 'effort', 'provider', 'dsh_profile']) {
      if (reviewer[field] !== undefined && (typeof reviewer[field] !== 'string' || !reviewer[field].trim())) {
        throw new Error(`[cc-nexs] review.panel ${reviewer.id} ${field} must be a non-empty string`);
      }
    }
    if (reviewer.executor !== 'native' && reviewer.profile !== undefined) {
      throw new Error(`[cc-nexs] review.panel ${reviewer.id}: profile applies to native reviewers; give a CLI reviewer its model`);
    }
    if (reviewer.executor === 'dsh-cli' && reviewer.model && !reviewer.provider && !reviewer.model.includes('/')) {
      throw new Error(`[cc-nexs] review.panel ${reviewer.id}: a dsh model needs provider (or provider/model)`);
    }
    return reviewer;
  });
}

export function reviewSkills(review = {}, workspaceRoot) {
  const skills = review.skills ?? [];
  if (!Array.isArray(skills) || skills.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('[cc-nexs] review.skills must be a list of skill file or directory paths');
  }
  return skills.map((item) => {
    const path = isAbsolute(item) ? item : resolve(workspaceRoot, item);
    const file = existsSync(join(path, 'SKILL.md')) ? join(path, 'SKILL.md') : path;
    if (!existsSync(file)) throw new Error(`[cc-nexs] review skill not found: ${item}`);
    return file;
  });
}

// The model a native reviewer runs on in this runtime: an explicit model, a named
// profile, or null (the role's normal routing).
export function nativeReviewerModel(reviewer, { runtime, models = {} }) {
  if (reviewer.model) return { model: reviewer.model, effort: reviewer.effort ?? 'inherit', source: 'panel' };
  if (!reviewer.profile) return null;
  const profile = models.profiles?.[reviewer.profile];
  if (!profile) throw new Error(`[cc-nexs] review.panel ${reviewer.id}: unknown model profile ${reviewer.profile}`);
  const entry = profile[runtime] || {};
  return {
    model: entry.model ?? 'inherit',
    effort: reviewer.effort ?? entry.effort ?? entry.reasoning_effort ?? entry.thinking ?? 'inherit',
    ...(entry.fallback_models && { fallback_models: entry.fallback_models }),
    source: `profile ${reviewer.profile}`,
  };
}

// The headless profile disables the account and credential plugins; turning them back
// on lets dsh use the account the user signed in with instead of an API key.
function dshPatch(reviewer) {
  let patch = '- id: credentials\n  disabled: false\n- id: deepseek-account\n  disabled: false\n';
  if (reviewer.model) {
    const [provider, model] = reviewer.provider ? [reviewer.provider, reviewer.model] : reviewer.model.split(/\/(.*)/s);
    patch += `- id: agent-default-model\n  config:\n    provider: ${JSON.stringify(provider)}\n    model: ${JSON.stringify(model)}\n`;
  }
  return patch;
}

// The argv for a CLI reviewer. The brief stays in a file; the prompt only points at it,
// so nothing large or sensitive goes on the command line.
export function planCliReviewer(reviewer, { prompt, cwd, runDir }) {
  const { model, effort } = reviewer;
  switch (reviewer.executor) {
    case 'codex-cli':
      return {
        executable: 'codex',
        args: ['exec', ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
          '-s', 'workspace-write', '--ephemeral', '--skip-git-repo-check', '-C', cwd, '-o', join(runDir, 'last-message.txt'), '-'],
        stdin: prompt,
      };
    case 'claude-cli':
      return {
        executable: 'claude',
        args: ['-p', ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
          '--output-format', 'json', '--no-session-persistence', '--add-dir', runDir,
          '--allowedTools', 'Bash Read Grep Glob', '--disallowedTools', 'Edit Write NotebookEdit'],
        stdin: prompt,
      };
    case 'agy-cli':
      return {
        executable: 'agy',
        args: [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []), '--add-dir', runDir,
          '--output-format', 'json', '--dangerously-skip-permissions', '--disable-slash-commands', `--print=${prompt}`],
      };
    case 'pi-cli':
      return {
        executable: 'pi',
        args: ['-p', '--no-session', '--no-extensions', '--no-prompt-templates', '--exclude-tools', 'edit,write',
          ...(model ? ['--model', effort ? `${model}:${effort}` : model] : []), prompt],
      };
    case 'dsh-cli': {
      const patch = join(runDir, 'dsh.patch.yml');
      return {
        executable: 'dsh',
        args: ['--profile', reviewer.dsh_profile || 'headless', '--patch', patch, '-'],
        stdin: prompt,
        files: { [patch]: dshPatch(reviewer) },
      };
    }
    default:
      throw new Error(`[cc-nexs] ${reviewer.executor} is not a CLI reviewer`);
  }
}

// Every JSON object in a text, outermost first, so a reply that wraps or repeats its
// answer still yields the findings.
function jsonObjects(text) {
  const found = [];
  const source = String(text || '');
  for (let start = source.indexOf('{'); start !== -1; start = source.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (char === '\\') i += 1;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try { found.push(JSON.parse(source.slice(start, i + 1))); } catch { /* not JSON */ }
        break;
      }
    }
  }
  return found;
}

export function extractFindings(text) {
  const queue = jsonObjects(text);
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value?.findings)) return value.findings;
    for (const nested of Object.values(value || {})) if (typeof nested === 'string') queue.push(...jsonObjects(nested));
  }
  throw new Error('[cc-nexs] reviewer reply has no JSON object with a findings array');
}

// The reply text and, where the CLI reports it, the model that actually ran.
export function parseCliReviewerOutput(executor, { stdout = '', stderr = '', lastMessage = '' }) {
  if (executor === 'codex-cli') {
    return { text: lastMessage || stdout, model: /^model:\s*(\S+)/m.exec(stderr)?.[1] ?? null };
  }
  if (executor === 'claude-cli') {
    const result = jsonObjects(stdout).find((item) => item.type === 'result' || 'result' in item) || {};
    return { text: typeof result.result === 'string' ? result.result : stdout, model: Object.keys(result.modelUsage || {})[0] ?? null };
  }
  if (executor === 'agy-cli') {
    const result = jsonObjects(stdout).find((item) => 'response' in item) || {};
    return { text: typeof result.response === 'string' ? result.response : stdout, model: null };
  }
  return { text: stdout, model: null };
}

function git(cwd, args) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).stdout ?? '';
}

export function worktreeSnapshot(worktrees) {
  return Object.fromEntries(Object.entries(worktrees).map(([id, path]) => [id, {
    head: git(path, ['rev-parse', 'HEAD']).trim(),
    status: git(path, ['status', '--porcelain', '--untracked-files=all']),
  }]));
}

export function reviewRunDir(workspaceRoot, featureId, round, reviewerId) {
  if (!REVIEW_ROUNDS.has(round)) throw new Error(`[cc-nexs] review round must be consolidated, closure, or gateway-b-delta: ${round}`);
  return join(taskFilesDir(workspaceRoot, featureId), 'review', round, reviewerId);
}

function resultFile(workspaceRoot, featureId, round, reviewerId) {
  return join(reviewRunDir(workspaceRoot, featureId, round, reviewerId), 'result.json');
}

export function writeReviewerResult({ workspaceRoot, featureId, round, reviewer, model, source, findings, runtime = detectRuntime() }) {
  if (!Array.isArray(findings)) throw new Error('[cc-nexs] reviewer findings must be an array');
  if (typeof model !== 'string' || !model.trim()) throw new Error(`[cc-nexs] record the model reviewer ${reviewer.id} ran on`);
  const file = resultFile(workspaceRoot, featureId, round, reviewer.id);
  mkdirSync(dirname(file), { recursive: true });
  const record = {
    reviewer: reviewer.id,
    executor: reviewer.executor,
    model,
    runtime,
    round,
    fingerprint: candidateFingerprint(source),
    source,
    findings,
    recorded_at: new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record };
}

export function readReviewerResult({ workspaceRoot, featureId, round, reviewerId }) {
  const file = resultFile(workspaceRoot, featureId, round, reviewerId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Windows cannot spawn a bare `codex` or `pi`: npm installs them as `.cmd` shims, and
// Node runs a `.cmd` only through a shell, which would re-parse the prompt argument.
// Find the command on PATH and launch what the shim launches, without a shell: an
// `.exe` directly, an npm/pnpm shim's script with this Node.
export function resolveCliCommand(executable, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command: executable, args };
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase());
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const file = join(dir, `${executable}${ext}`);
      if (!existsSync(file)) continue;
      if (ext === '.exe' || ext === '.com') return { command: file, args };
      if (ext !== '.cmd' && ext !== '.bat') continue;
      const target = shimTarget(readFileSync(file, 'utf8'), dir);
      if (!target) throw new Error(`[cc-nexs] ${file} is not an npm or pnpm shim; put ${executable}.exe on PATH or use a native reviewer`);
      return /\.[cm]?js$/i.test(target) ? { command: process.execPath, args: [target, ...args] } : { command: target, args };
    }
  }
  throw new Error(`[cc-nexs] ${executable} was not found on PATH`);
}

// The last quoted %dp0%-relative path before `%*` in the shim is the program it runs.
function shimTarget(shim, dir) {
  const matches = [...shim.matchAll(/"%~?dp0%?\\?([^"%]+)"\s+%\*/gi)];
  const relative = matches.at(-1)?.[1];
  return relative ? join(dir, ...relative.split(/[\\/]/).filter(Boolean)) : null;
}

// Runs one CLI reviewer in the workspace and stores its findings. A reviewer that
// changed any candidate worktree is discarded: its findings no longer describe the
// candidate, and the change has to be looked at by a person.
export function runCliReviewer({ workspaceRoot, featureId, round, reviewer, briefFile, source, worktrees, spawn = spawnSync, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, runtime = detectRuntime(), platform = process.platform }) {
  if (reviewer.executor === 'native') throw new Error(`[cc-nexs] ${reviewer.id} is a native reviewer; dispatch it as a subagent and record it with record-reviewer`);
  if (!existsSync(briefFile)) throw new Error(`[cc-nexs] review brief not found: ${briefFile}`);
  const runDir = reviewRunDir(workspaceRoot, featureId, round, reviewer.id);
  mkdirSync(runDir, { recursive: true });
  const prompt = `Read the review brief at ${briefFile} and follow it exactly. Reply with only the JSON object it asks for: {"findings": [...]}.`;
  const plan = planCliReviewer(reviewer, { prompt, cwd: workspaceRoot, runDir });
  for (const [file, content] of Object.entries(plan.files || {})) writeFileSync(file, content);
  const before = worktreeSnapshot(worktrees);
  const { command, args } = resolveCliCommand(plan.executable, plan.args, { platform });
  const result = spawn(command, args, {
    cwd: workspaceRoot, encoding: 'utf8', input: plan.stdin, timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(join(runDir, 'stdout.txt'), result.stdout || '');
  writeFileSync(join(runDir, 'stderr.txt'), result.stderr || '');
  const after = worktreeSnapshot(worktrees);
  const changed = Object.keys(before).filter((id) => JSON.stringify(before[id]) !== JSON.stringify(after[id]));
  if (changed.length) throw new Error(`[cc-nexs] reviewer ${reviewer.id} changed candidate worktree(s) ${changed.join(', ')}; its findings were discarded. Inspect and restore the worktree before reviewing again`);
  if (result.error) throw new Error(`[cc-nexs] could not run ${plan.executable} for reviewer ${reviewer.id}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`[cc-nexs] reviewer ${reviewer.id} (${plan.executable}) exited with ${result.status ?? result.signal}; see ${runDir}/stderr.txt`);
  const lastMessageFile = join(runDir, 'last-message.txt');
  const parsed = parseCliReviewerOutput(reviewer.executor, {
    stdout: result.stdout, stderr: result.stderr, lastMessage: existsSync(lastMessageFile) ? readFileSync(lastMessageFile, 'utf8') : '',
  });
  const findings = extractFindings(parsed.text);
  const model = parsed.model || reviewer.model || `${reviewer.executor} default`;
  return writeReviewerResult({ workspaceRoot, featureId, round, reviewer, model, source, findings, runtime });
}

function panelContext({ cwd, featureId, progressPath, runtime }) {
  const context = resolveCandidateContext({ cwd, featureId, progressPath });
  assertReviewRequired(context.progress, context.config.mergedReview);
  return { context, runtime, panel: resolveReviewPanel(context.config.mergedReview, runtime), featureKey: String(context.progress.feature.id) };
}

function round(value = 'consolidated') {
  if (!REVIEW_ROUNDS.has(value)) throw new Error(`[cc-nexs] --round must be consolidated, closure, or gateway-b-delta: ${value}`);
  return value;
}

function member(panel, reviewerId) {
  const reviewer = panel.find((item) => item.id === reviewerId);
  if (!reviewer) throw new Error(`[cc-nexs] reviewer ${reviewerId || '(missing --reviewer)'} is not in review.panel (${panel.map((item) => item.id).join(', ')})`);
  return reviewer;
}

function candidateWorktrees(context) {
  return Object.fromEntries(context.repositories.map((item) => [item.id,
    item.assignment.worktree ? resolve(context.workspaceRoot, item.assignment.worktree) : item.repository.absolute_path]));
}

// What the Orchestrator needs to run a round: who reviews, on which model, the role
// and rule files and skills every brief points at, and what has been stored so far.
export function reviewPanelStatus({ cwd = process.cwd(), featureId, progressPath = null, runtime = detectRuntime(), round: roundName } = {}) {
  const { context, panel, featureKey } = panelContext({ cwd, featureId, progressPath, runtime });
  const reviewRound = round(roundName);
  const role = context.progress.mode === 'hotfix' ? 'hotfix-reviewer' : 'lean-reviewer';
  const roleFile = join(PLUGIN_ROOT, 'agents', `${role}.md`);
  return {
    kind: 'review-panel',
    feature: context.progress.feature,
    runtime,
    round: reviewRound,
    role,
    brief_inputs: {
      role_file: existsSync(roleFile) ? roleFile : null,
      rules_file: join(PLUGIN_ROOT, 'rules', 'review-findings.md'),
      skills: reviewSkills(context.config.mergedReview, context.workspaceRoot),
      brief_file: join(taskFilesDir(context.workspaceRoot, featureKey), 'review', reviewRound, 'brief.md'),
    },
    reviewers: (reviewRound === 'consolidated' ? panel : panel.slice(0, 1)).map((reviewer) => {
      const stored = readReviewerResult({ workspaceRoot: context.workspaceRoot, featureId: featureKey, round: reviewRound, reviewerId: reviewer.id });
      const current = stored?.fingerprint === candidateFingerprint(context.source);
      return {
        id: reviewer.id,
        executor: reviewer.executor,
        ...(reviewer.executor === 'native'
          ? { model: nativeReviewerModel(reviewer, { runtime, models: context.config.mergedModels }) || 'role routing' }
          : { model: reviewer.model || `${reviewer.executor} default`, ...(reviewer.effort && { effort: reviewer.effort }) }),
        stored: current ? { model: stored.model, findings: stored.findings.length } : null,
      };
    }),
  };
}

export function runPanelReviewer({ cwd = process.cwd(), featureId, progressPath = null, runtime = detectRuntime(), reviewerId, round: roundName, briefFile } = {}) {
  const { context, panel, featureKey } = panelContext({ cwd, featureId, progressPath, runtime });
  const reviewer = member(panel, reviewerId);
  if (!briefFile) throw new Error('[cc-nexs] run-reviewer requires --brief <file>');
  const { file, record } = runCliReviewer({
    workspaceRoot: context.workspaceRoot, featureId: featureKey, round: round(roundName), reviewer,
    briefFile: resolve(cwd, briefFile), source: context.source, worktrees: candidateWorktrees(context),
    timeoutSeconds: reviewer.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS, runtime,
  });
  return { kind: 'reviewer-result', reviewer: record.reviewer, executor: record.executor, model: record.model, findings: record.findings.length, file };
}

// A native reviewer's reply, saved by the Orchestrator. CLI reviewers store their own
// results through run-reviewer, so they cannot be recorded by hand.
export function recordPanelReviewer({ cwd = process.cwd(), featureId, progressPath = null, runtime = detectRuntime(), reviewerId, round: roundName, model, findingsFile } = {}) {
  const { context, panel, featureKey } = panelContext({ cwd, featureId, progressPath, runtime });
  const reviewer = member(panel, reviewerId);
  if (reviewer.executor !== 'native') throw new Error(`[cc-nexs] ${reviewer.id} is a ${reviewer.executor} reviewer; run it with run-reviewer`);
  if (!findingsFile) throw new Error('[cc-nexs] record-reviewer requires --findings-file <file>');
  const text = readFileSync(resolve(cwd, findingsFile), 'utf8');
  let findings;
  try { const parsed = JSON.parse(text); findings = Array.isArray(parsed) ? parsed : extractFindings(text); } catch { findings = extractFindings(text); }
  const { file, record } = writeReviewerResult({
    workspaceRoot: context.workspaceRoot, featureId: featureKey, round: round(roundName), reviewer, model, source: context.source, findings, runtime,
  });
  return { kind: 'reviewer-result', reviewer: record.reviewer, executor: record.executor, model: record.model, findings: record.findings.length, file };
}
