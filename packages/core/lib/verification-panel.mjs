// Verification panel: several independent Verifiers, on different models, run the same
// acceptance matrix against the same deployed revision. Verification is the main gate,
// so it gets the second pair of eyes a code Review panel used to get.
//
// Each Verifier reports every check as passed, failed, or not_run. Per check:
//   - failed when two Verifiers failed it, or one did and an independent rerun confirmed it;
//   - a single unconfirmed failure must be rerun (--confirm-json) before it is recorded;
//   - passed when at least one Verifier passed it and none failed;
//   - not_run when no Verifier could run it (it becomes a human-input blocker).
//
//   verify:
//     panel:            # a list for every runtime, or a map of claude/codex/pi lists
//       - id: v1        # native Verifier on the role routing
//       - id: v2
//         profile: acceptance-alt   # or model: <id> (+ effort)

import { nativeReviewerModel } from './review-panel.mjs';

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const RUNTIMES = new Set(['claude', 'codex', 'pi']);
const CHECK_RESULTS = new Set(['passed', 'failed', 'not_run']);
const CONCLUSION = { passed: '测试结论: 通过', blocked: '测试结论: 阻塞' };

export function resolveVerifyPanel(verify = {}, runtime) {
  let entries = verify.panel;
  if (entries === undefined) return [];
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    const unknown = Object.keys(entries).filter((key) => !RUNTIMES.has(key));
    if (unknown.length) throw new Error(`[cc-nexs] verify.panel keys must be claude, codex, or pi: ${unknown.join(', ')}`);
    entries = entries[runtime];
    if (entries === undefined) return [];
  }
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('[cc-nexs] verify.panel needs at least two Verifiers; leave it unset for a single Verifier');
  const seen = new Set();
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('[cc-nexs] each verify.panel entry must be an object');
    const verifier = { ...entry, id: entry.id ?? `v${index + 1}` };
    if (!ID.test(verifier.id)) throw new Error(`[cc-nexs] verify.panel id must be lowercase letters, digits, and dashes: ${verifier.id}`);
    if (seen.has(verifier.id)) throw new Error(`[cc-nexs] duplicate verify.panel id: ${verifier.id}`);
    seen.add(verifier.id);
    for (const field of ['profile', 'model', 'effort']) {
      if (verifier[field] !== undefined && (typeof verifier[field] !== 'string' || !verifier[field].trim())) {
        throw new Error(`[cc-nexs] verify.panel ${verifier.id} ${field} must be a non-empty string`);
      }
    }
    return verifier;
  });
}

export function verifyPanelModels(panel, { runtime, models }) {
  return panel.map((verifier) => ({ id: verifier.id, model: nativeReviewerModel(verifier, { runtime, models }) || 'role routing' }));
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mergeVerifierResults(verifiers, { requiredChecks = [], confirmations = [], panel = [] } = {}) {
  if (!Array.isArray(verifiers) || verifiers.length < 2) throw new Error('[cc-nexs] a verification panel needs at least two Verifier results');
  const ids = verifiers.map((item) => item?.verifier);
  if (ids.some((id) => !text(id)) || new Set(ids).size !== ids.length) throw new Error('[cc-nexs] each Verifier result needs a unique verifier id');
  if (panel.length) {
    const expected = panel.map((item) => item.id).sort();
    if (JSON.stringify([...ids].sort()) !== JSON.stringify(expected)) {
      throw new Error(`[cc-nexs] the verification panel is ${expected.join(', ')}; got results from ${ids.join(', ')}`);
    }
  }
  const checks = requiredChecks.length ? requiredChecks : [...new Set(verifiers.flatMap((item) => (item.checks || []).map((entry) => entry?.check)))];
  for (const verifier of verifiers) {
    if (!text(verifier.model)) throw new Error(`[cc-nexs] Verifier ${verifier.verifier} must name the model it ran on`);
    const byCheck = new Map((verifier.checks || []).map((entry) => [entry?.check, entry]));
    for (const check of checks) {
      const entry = byCheck.get(check);
      if (!entry) throw new Error(`[cc-nexs] Verifier ${verifier.verifier} did not report ${check}`);
      if (!CHECK_RESULTS.has(entry.result)) throw new Error(`[cc-nexs] Verifier ${verifier.verifier} ${check}: result must be passed, failed, or not_run`);
      if (entry.result === 'not_run' ? !text(entry.reason) : !text(entry.proof)) {
        throw new Error(`[cc-nexs] Verifier ${verifier.verifier} ${check}: ${entry.result === 'not_run' ? 'not_run needs a reason' : `${entry.result} needs proof`}`);
      }
    }
  }
  const confirmed = new Map();
  for (const item of confirmations) {
    if (!checks.includes(item?.check) || !['passed', 'failed'].includes(item.result) || !text(item.proof) || !text(item.verifier)) {
      throw new Error('[cc-nexs] a confirmation needs a matrix check, result passed or failed, proof, and the verifier that reran it');
    }
    confirmed.set(item.check, item);
  }
  const rows = [];
  const disputed = [];
  for (const check of checks) {
    const entries = verifiers.map((verifier) => ({ verifier: verifier.verifier, ...(verifier.checks.find((entry) => entry.check === check)) }));
    const failed = entries.filter((entry) => entry.result === 'failed');
    const passed = entries.filter((entry) => entry.result === 'passed');
    const rerun = confirmed.get(check);
    let result;
    if (failed.length >= 2) result = 'failed';
    else if (failed.length === 1) {
      if (!rerun) { disputed.push(`${check} (failed only by ${failed[0].verifier})`); continue; }
      if (rerun.verifier === failed[0].verifier) throw new Error(`[cc-nexs] ${check} must be confirmed by a Verifier other than ${failed[0].verifier}`);
      result = rerun.result;
    } else result = passed.length ? 'passed' : 'not_run';
    rows.push({ check, result, entries, ...(rerun && failed.length === 1 && { confirmation: rerun }) });
  }
  if (disputed.length) {
    throw new Error(`[cc-nexs] rerun these checks with another Verifier and record the outcome with --confirm-json before recording the panel: ${disputed.join('; ')}`);
  }
  const notRun = rows.filter((row) => row.result === 'not_run');
  const blockers = notRun.map((row) => {
    const entry = row.entries.find((item) => text(item.required_input)) || row.entries[0];
    return {
      type: 'human_input_required', check: row.check, reason: entry.reason,
      attempted: entry.attempted || row.entries.map((item) => `${item.verifier}: ${item.reason}`).join('; '),
      required_input: entry.required_input || '', resume_action: entry.resume_action || '',
    };
  });
  const status = rows.some((row) => row.result === 'failed') ? 'blocked' : notRun.length ? 'manual_required' : 'passed';
  const evidence = [
    ...rows.flatMap((row) => row.entries.map((entry) => ({ check: row.check, verifier: entry.verifier, result: entry.result, proof: entry.proof || entry.reason }))),
    ...rows.filter((row) => row.confirmation).map((row) => ({ check: row.check, verifier: row.confirmation.verifier, result: row.confirmation.result, proof: row.confirmation.proof, type: 'confirmation' })),
    ...rows.map((row) => ({ check: row.check, result: row.result, type: 'panel_result' })),
    ...(status === 'manual_required' ? blockers : []),
  ];
  return { status, rows, evidence, models: Object.fromEntries(verifiers.map((item) => [item.verifier, item.model])) };
}

function cell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function renderPanelVerification({ attemptId, environmentRevision = {}, status, rows, models }) {
  const ids = Object.keys(models);
  const revision = Object.entries(environmentRevision).map(([repo, sha]) => `${repo}@${String(sha).slice(0, 12)}`).join(', ');
  return [
    `### ${attemptId} — verification panel`,
    '',
    `- Environment revision: ${revision || 'n/a'}`,
    `- Verifiers: ${ids.map((id) => `${id} (${models[id]})`).join(', ')}`,
    '',
    `| Check | ${ids.join(' | ')} | Result |`,
    `|---|${ids.map(() => '---|').join('')}---|`,
    ...rows.map((row) => `| ${cell(row.check)} | ${ids.map((id) => {
      const entry = row.entries.find((item) => item.verifier === id);
      return cell(`${entry.result}: ${entry.proof || entry.reason}`);
    }).join(' | ')} | ${cell(row.confirmation ? `${row.result} (rerun by ${row.confirmation.verifier})` : row.result)} |`),
    '',
    CONCLUSION[status] || '- Result: manual_required (see the human-input blockers above)',
    '',
  ].join('\n');
}
