import { jsonValuesEqual } from './canonical-json.mjs';

const BROWSER_COMMAND = /^browser:\s*\S/;

export function assertRecordedLocalVerification(progress, { source, fingerprint, expectedChecks = [] }) {
  const verification = progress.local_verification;
  const latest = verification?.attempts?.at(-1);
  const allowed = progress.mode === 'lean' ? ['passed', 'deferred_to_test'] : ['passed'];
  if (!allowed.includes(verification?.status) || verification.candidate_fingerprint !== fingerprint
    || latest?.status !== verification.status || latest.fingerprint !== fingerprint
    || !jsonValuesEqual(latest.source, source)) {
    throw new Error('[cc-nexs] local verification requires the latest passing or permitted deferred attempt for the exact candidate');
  }
  const evidence = Array.isArray(latest.evidence)
    ? latest.evidence.filter((item) => item?.type !== 'p3_boundary' || Object.hasOwn(item, 'result')) : latest.evidence;
  validateLocalEvidence(latest.status, evidence, {
    allowTestDefer: progress.mode === 'lean', expectedChecks,
  });
  return latest;
}

export function extractLocalVerificationChecks(scope) {
  const checks = [];
  let commandColumn = -1;
  for (const line of String(scope).split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      commandColumn = -1;
      continue;
    }
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replace(/\\\|/g, '|').replace(/^`(.*)`$/, '$1'));
    if (cells[0] === 'Check') {
      commandColumn = cells.findIndex((cell) => ['命令/Driver', 'Command/Driver', 'Command'].includes(cell));
      continue;
    }
    if (commandColumn === -1 || /^:?-+:?$/.test(cells[0])) continue;
    const check = cells[0];
    const command = cells[commandColumn];
    if (!check || !command || ['-', 'pending'].includes(command) || checks.some((item) => item.check === check)) {
      throw new Error('[cc-nexs] local verification matrix requires unique Check IDs and exact nonempty commands');
    }
    // Command rows keep their exact shape so existing contract fingerprints stay valid.
    checks.push({ check, command, ...(BROWSER_COMMAND.test(command) && { method: 'browser' }) });
  }
  return checks;
}

export function validateLocalEvidence(status, evidence, { allowTestDefer = false, expectedChecks = [] } = {}) {
  if (!['passed', 'failed', ...(allowTestDefer ? ['deferred_to_test'] : [])].includes(status)) {
    throw new Error(`[cc-nexs] invalid local verification status: ${status || '<missing>'}`);
  }
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.some((item) => (
    !item || typeof item !== 'object' || Array.isArray(item) || typeof item.check !== 'string' || !item.check.trim()
  ))) {
    throw new Error('[cc-nexs] local verification requires structured evidence with nonempty check IDs');
  }
  const checks = evidence.map((item) => item.check.trim());
  if (new Set(checks).size !== checks.length) throw new Error('[cc-nexs] local verification evidence contains duplicate checks');
  for (const item of evidence) {
    if ((item.result === 'passed' || item.result === 'failed') && item.method === 'browser') {
      // A browser observation has no exit code; its proof is the page state that was seen.
      if (typeof item.command !== 'string' || !BROWSER_COMMAND.test(item.command.trim())
        || typeof item.proof !== 'string' || !item.proof.trim()) {
        throw new Error('[cc-nexs] browser local evidence requires check, a browser: command, and proof');
      }
    } else if (item.result === 'passed' || item.result === 'failed') {
      if (typeof item.command !== 'string' || !item.command.trim()
        || typeof item.proof !== 'string' || !item.proof.trim()
        || !Number.isInteger(item.exit_code) || (item.result === 'passed' ? item.exit_code !== 0 : item.exit_code === 0)) {
        throw new Error(`[cc-nexs] ${item.result === 'passed' ? 'passing' : 'failing'} local evidence requires check, command, ${item.result === 'passed' ? 'exit_code=0' : 'a nonzero integer exit_code'}, and proof`);
      }
    } else if (item.result === 'baseline_failed') {
      // The same command already fails on the candidate's merge-base: a pre-existing base
      // failure is recorded and shown at Gateway B instead of blocking every task on it.
      if (typeof item.command !== 'string' || !item.command.trim()
        || typeof item.proof !== 'string' || !item.proof.trim()
        || !Number.isInteger(item.exit_code) || item.exit_code === 0
        || typeof item.repository !== 'string' || !item.repository.trim()
        || typeof item.baseline_commit !== 'string' || !/^[0-9a-f]{40}$/.test(item.baseline_commit)
        || !Number.isInteger(item.baseline_exit_code) || item.baseline_exit_code === 0
        || typeof item.baseline_proof !== 'string' || !item.baseline_proof.trim()) {
        throw new Error('[cc-nexs] baseline_failed evidence requires check, command, nonzero exit_code, proof, repository, the 40-character baseline_commit, a nonzero baseline_exit_code, and baseline_proof');
      }
    } else if (item.result !== 'deferred_to_test' || !allowTestDefer
      || typeof item.reason !== 'string' || !item.reason.trim()
      || typeof item.test_action !== 'string' || !item.test_action.trim()) {
      throw new Error('[cc-nexs] local evidence requires passed/failed command results or structured test deferral evidence');
    }
    const expected = expectedChecks.find((check) => check.check === item.check.trim());
    if (expected && item.result !== 'deferred_to_test' && item.command.trim() !== expected.command) {
      throw new Error(`[cc-nexs] local verification command does not match the bound matrix for ${expected.check}`);
    }
    if (expected?.method === 'browser' && item.result !== 'deferred_to_test' && item.method !== 'browser') {
      throw new Error(`[cc-nexs] local verification check ${expected.check} requires browser evidence`);
    }
  }
  if (status === 'failed') {
    if (!evidence.some((item) => item.result === 'failed') || evidence.some((item) => !['passed', 'failed', 'baseline_failed'].includes(item.result))) {
      throw new Error('[cc-nexs] a failed local verification requires at least one failed command and may contain only passed, failed, or baseline_failed evidence');
    }
    return;
  }
  if (status === 'passed' && evidence.some((item) => !['passed', 'baseline_failed'].includes(item.result))) {
    throw new Error('[cc-nexs] a passing local verification may contain only passed or baseline_failed evidence');
  }
  if (status === 'deferred_to_test' && (!evidence.some((item) => item.result === 'deferred_to_test')
    || evidence.some((item) => !['passed', 'deferred_to_test', 'baseline_failed'].includes(item.result)))) {
    throw new Error('[cc-nexs] deferred local verification requires structured test deferral evidence');
  }
  if (!evidence.some((item) => item.result === 'passed' && item.method !== 'browser')) {
    throw new Error('[cc-nexs] local evidence requires at least one passed command with check, command, exit_code=0, and proof');
  }
  const missing = expectedChecks.filter((expected) => !checks.includes(expected.check));
  if (missing.length) throw new Error(`[cc-nexs] local verification evidence must cover bound checks: ${missing.map((item) => item.check).join(', ')}`);
}
