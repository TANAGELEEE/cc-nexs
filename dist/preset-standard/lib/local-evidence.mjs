import { jsonValuesEqual } from './canonical-json.mjs';

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
      commandColumn = cells.findIndex((cell) => ['命令/Driver', 'Command'].includes(cell));
      continue;
    }
    if (commandColumn === -1 || /^:?-+:?$/.test(cells[0])) continue;
    const check = cells[0];
    const command = cells[commandColumn];
    if (!check || !command || ['-', 'pending'].includes(command) || checks.some((item) => item.check === check)) {
      throw new Error('[cc-nexs] local verification matrix requires unique Check IDs and exact nonempty commands');
    }
    checks.push({ check, command });
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
    if (item.result === 'passed' || item.result === 'failed') {
      if (typeof item.command !== 'string' || !item.command.trim()
        || typeof item.proof !== 'string' || !item.proof.trim()
        || !Number.isInteger(item.exit_code) || (item.result === 'passed' ? item.exit_code !== 0 : item.exit_code === 0)) {
        throw new Error(`[cc-nexs] ${item.result === 'passed' ? 'passing' : 'failing'} local evidence requires check, command, ${item.result === 'passed' ? 'exit_code=0' : 'a nonzero integer exit_code'}, and proof`);
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
  }
  if (status === 'failed') {
    if (!evidence.some((item) => item.result === 'failed') || evidence.some((item) => !['passed', 'failed'].includes(item.result))) {
      throw new Error('[cc-nexs] a failed local verification requires at least one failed command and may contain only passed or failed evidence');
    }
    return;
  }
  if (status === 'passed' && evidence.some((item) => item.result !== 'passed')) {
    throw new Error('[cc-nexs] a passing local verification may contain only passed evidence');
  }
  if (status === 'deferred_to_test' && (!evidence.some((item) => item.result === 'deferred_to_test')
    || evidence.some((item) => !['passed', 'deferred_to_test'].includes(item.result)))) {
    throw new Error('[cc-nexs] deferred local verification requires structured test deferral evidence');
  }
  if (!evidence.some((item) => item.result === 'passed')) {
    throw new Error('[cc-nexs] local evidence requires at least one passed command with check, command, exit_code=0, and proof');
  }
  const missing = expectedChecks.filter((expected) => !checks.includes(expected.check));
  if (missing.length) throw new Error(`[cc-nexs] local verification evidence must cover bound checks: ${missing.map((item) => item.check).join(', ')}`);
}
