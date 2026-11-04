// Evidence-gated Review findings.
//
// A Reviewer writes one fenced `cc-nexs-review` JSON block per Review round in the
// bound review document (Lean plan.md or the Hotfix BUG document). The controller
// classifies every finding; only a P0/P1 failure that a run demonstrated blocks.
// Everything else is recorded and shown at Gateway B, so the test environment and
// the human decide unproven risk instead of another automated Review round.

const BLOCK = /^```cc-nexs-review[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
const ROUNDS = new Set(['consolidated', 'closure', 'gateway-b-delta']);
const ANCHOR = /^(?:AC-[A-Za-z0-9_-]+|contract|data|security|regression|evidence-mismatch)$/;

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function extractReviewBlock(documentText) {
  const blocks = [...String(documentText || '').matchAll(BLOCK)];
  if (blocks.length === 0) throw new Error('[cc-nexs] review document has no `cc-nexs-review` block');
  try {
    return JSON.parse(blocks.at(-1)[1]);
  } catch (error) {
    throw new Error(`[cc-nexs] the last \`cc-nexs-review\` block is not valid JSON: ${error.message}`);
  }
}

function rejection(finding) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return 'finding must be an object';
  for (const field of ['id', 'location', 'failure_scenario']) {
    if (!text(finding[field])) return `missing ${field}`;
  }
  if (!['P0', 'P1', 'P2', 'P3'].includes(finding.severity)) return 'severity must be P0, P1, P2, or P3';
  if (!text(finding.anchor) || !ANCHOR.test(finding.anchor)) {
    return 'anchor must be an AC id, contract, data, security, regression, or evidence-mismatch';
  }
  const evidence = finding.evidence;
  if (evidence?.kind === 'run') {
    if (!text(evidence.command) || !text(evidence.observed)) return 'run evidence needs command and observed output';
  } else if (evidence?.kind === 'trace') {
    if (!Array.isArray(evidence.refs) || !evidence.refs.some(text)) return 'trace evidence needs refs';
  } else {
    return 'evidence.kind must be run or trace';
  }
  return null;
}

function summary(finding) {
  return `${finding.severity}: ${finding.id} ${finding.location} — ${finding.failure_scenario}`;
}

export function classifyReviewFindings(findings, { notReproduced = [] } = {}) {
  if (!Array.isArray(findings)) throw new Error('[cc-nexs] review findings must be an array');
  const notReproducedIds = new Set(notReproduced);
  const seen = new Set();
  const classified = findings.map((finding) => {
    let reason = rejection(finding);
    if (!reason && seen.has(finding.id)) reason = 'duplicate id';
    if (reason) return { finding, class: 'rejected', reason };
    seen.add(finding.id);
    if (['P2', 'P3'].includes(finding.severity)) return { finding, class: 'advisory' };
    if (finding.anchor === 'evidence-mismatch') return { finding, class: 'blocking' };
    if (finding.evidence.kind !== 'run') return { finding, class: 'unproven', reason: 'no run demonstrated the failure' };
    if (notReproducedIds.has(finding.id)) return { finding, class: 'unproven', reason: 'Orchestrator rerun did not reproduce the failure' };
    return { finding, class: 'blocking' };
  });
  const unknown = [...notReproducedIds].filter((id) => !seen.has(id));
  if (unknown.length > 0) throw new Error(`[cc-nexs] --not-reproduced names unknown finding ids: ${unknown.join(', ')}`);
  const counts = { blocking: 0, unproven: 0, advisory: 0, rejected: 0 };
  for (const item of classified) counts[item.class] += 1;
  return {
    classified,
    counts,
    blockingFindings: classified.filter((item) => item.class === 'blocking').map((item) => summary(item.finding)),
  };
}

export function readReviewFindings(documentText, { round, source, notReproduced = [] }) {
  const block = extractReviewBlock(documentText);
  if (!ROUNDS.has(block?.round)) throw new Error('[cc-nexs] review block round must be consolidated, closure, or gateway-b-delta');
  if (block.round !== round) {
    throw new Error(`[cc-nexs] the last review block is for ${block.round}, but this record is ${round}`);
  }
  const expected = JSON.stringify(Object.entries(source).sort());
  const actual = JSON.stringify(Object.entries(block.candidate || {}).sort());
  if (actual !== expected) {
    throw new Error('[cc-nexs] review block candidate does not match the exact candidate commits');
  }
  return classifyReviewFindings(block.findings ?? [], { notReproduced });
}
