// Sharded test-environment verification.
//
// When the acceptance matrix splits into independent groups, the Orchestrator may run
// several black-box Verifiers in parallel. Each returns its shard result and writes
// nothing; the controller merges them, derives one conclusion, and renders a single
// acceptance section, so parallel sessions never edit the same document.

const RESULTS = new Set(['passed', 'blocked', 'manual_required']);
const CONCLUSION = { passed: '测试结论: 通过', blocked: '测试结论: 阻塞' };
const SECTION = /^##\s+(?:Test 环境验收|Test 環境驗收|Test Environment Acceptance)\s*$/m;

export function acceptanceCheckIds(approvalScope) {
  return [...new Set([...String(approvalScope || '').matchAll(/^\|\s*(TV-\d+)\s*\|/gm)].map((match) => match[1]))];
}

export function mergeShardResults(shards, { requiredChecks = [] } = {}) {
  if (!Array.isArray(shards) || shards.length < 2) throw new Error('[cc-nexs] sharded verification needs at least two shard results');
  const names = new Set();
  const assigned = new Set();
  for (const shard of shards) {
    if (!shard || typeof shard.shard !== 'string' || !shard.shard.trim()) throw new Error('[cc-nexs] each shard needs a shard name');
    if (names.has(shard.shard)) throw new Error(`[cc-nexs] duplicate shard: ${shard.shard}`);
    names.add(shard.shard);
    if (!RESULTS.has(shard.result)) throw new Error(`[cc-nexs] shard ${shard.shard} result must be passed, blocked, or manual_required`);
    if (!Array.isArray(shard.checks) || shard.checks.length === 0) throw new Error(`[cc-nexs] shard ${shard.shard} must list its assigned checks`);
    if (!Array.isArray(shard.evidence) || shard.evidence.length === 0) throw new Error(`[cc-nexs] shard ${shard.shard} has no evidence`);
    for (const check of shard.checks) assigned.add(check);
    const reported = new Set(shard.evidence.map((item) => item?.check));
    const unreported = shard.checks.filter((check) => !reported.has(check));
    if (unreported.length > 0) throw new Error(`[cc-nexs] shard ${shard.shard} has no evidence for ${unreported.join(', ')}`);
  }
  const unassigned = requiredChecks.filter((check) => !assigned.has(check));
  if (unassigned.length > 0) throw new Error(`[cc-nexs] no shard was assigned ${unassigned.join(', ')}`);
  const results = shards.map((shard) => shard.result);
  const status = results.includes('blocked') ? 'blocked' : results.includes('manual_required') ? 'manual_required' : 'passed';
  return { status, evidence: shards.flatMap((shard) => shard.evidence.map((item) => ({ ...item, shard: shard.shard }))) };
}

function cell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

export function renderShardedVerification({ attemptId, environmentRevision = {}, status, evidence }) {
  const revision = Object.entries(environmentRevision).map(([repo, sha]) => `${repo}@${String(sha).slice(0, 12)}`).join(', ');
  return [
    `### ${attemptId} — sharded verification`,
    '',
    `- Environment revision: ${revision || 'n/a'}`,
    '',
    '| Shard | Check | Result | Proof |',
    '|---|---|---|---|',
    ...evidence.map((item) => `| ${cell(item.shard)} | ${cell(item.check || item.type)} | ${cell(item.result)} | ${cell(item.proof || item.reason)} |`),
    '',
    CONCLUSION[status] || '- Result: manual_required (see the human-input blockers above)',
    '',
  ].join('\n');
}

export function insertVerificationSection(documentText, section) {
  const text = String(documentText || '');
  const heading = SECTION.exec(text);
  if (!heading) return `${text.trimEnd()}\n\n${section}`;
  const afterHeading = heading.index + heading[0].length;
  const next = text.slice(afterHeading).search(/^##\s/m);
  const at = next < 0 ? text.length : afterHeading + next;
  return `${text.slice(0, at).trimEnd()}\n\n${section}\n${text.slice(at)}`;
}
