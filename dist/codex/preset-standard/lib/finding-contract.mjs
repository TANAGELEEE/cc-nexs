// Evidence-gated Review findings.
//
// The review panel's reviewers run the same brief on the exact candidate and return
// their findings. A Judge in a fresh session reruns every P0/P1 command, merges
// duplicates, and writes one fenced `cc-nexs-review` JSON block per Review round in
// the bound review document (Lean plan.md or the Hotfix BUG document). The controller
// classifies every finding; only a P0/P1 failure that a run demonstrated and the Judge
// rerun confirmed blocks. Everything else is recorded and shown at Gateway B, so the
// test environment and the human decide unproven risk instead of another Review round.

const BLOCK = /^```cc-nexs-review[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;
const ROUNDS = new Set(['consolidated', 'closure', 'gateway-b-delta']);
const ANCHOR = /^(?:AC-[A-Za-z0-9_-]+|contract|data|security|regression|evidence-mismatch)$/;
const VERDICTS = new Set(['confirmed', 'refuted', 'plausible']);

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

function rejection(finding, reviewerIds) {
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) return 'finding must be an object';
  if (reviewerIds && finding.found_by !== undefined
    && (!Array.isArray(finding.found_by) || finding.found_by.length === 0 || finding.found_by.some((id) => !reviewerIds.has(id)))) {
    return 'found_by must name reviewers listed in the block';
  }
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
  if (finding.judge !== undefined && (!VERDICTS.has(finding.judge?.verdict))) {
    return 'judge.verdict must be confirmed, refuted, or plausible';
  }
  return null;
}

function summary(finding) {
  return `${finding.severity}: ${finding.id} ${finding.location} — ${finding.failure_scenario}`;
}

function classify(finding, notReproducedIds) {
  if (['P2', 'P3'].includes(finding.severity)) return { class: 'advisory' };
  const verdict = finding.judge?.verdict;
  if (verdict === 'refuted') return { class: 'refuted', reason: 'Judge rerun refuted the failure' };
  if (finding.anchor === 'evidence-mismatch') return { class: 'blocking' };
  if (finding.evidence.kind !== 'run') return { class: 'unproven', reason: 'no run demonstrated the failure' };
  if (notReproducedIds.has(finding.id)) return { class: 'unproven', reason: 'Orchestrator rerun did not reproduce the failure' };
  if (verdict !== 'confirmed' || !text(finding.judge?.rerun)) {
    return { class: 'unproven', reason: 'the Judge did not confirm the failure with a rerun' };
  }
  return { class: 'blocking' };
}

export function classifyReviewFindings(findings, { notReproduced = [], reviewerIds = null } = {}) {
  if (!Array.isArray(findings)) throw new Error('[cc-nexs] review findings must be an array');
  const notReproducedIds = new Set(notReproduced);
  const seen = new Set();
  const classified = findings.map((finding) => {
    let reason = rejection(finding, reviewerIds);
    if (!reason && seen.has(finding.id)) reason = 'duplicate id';
    if (reason) return { finding, class: 'rejected', reason };
    seen.add(finding.id);
    return { finding, ...classify(finding, notReproducedIds) };
  });
  const unknown = [...notReproducedIds].filter((id) => !seen.has(id));
  if (unknown.length > 0) throw new Error(`[cc-nexs] --not-reproduced names unknown finding ids: ${unknown.join(', ')}`);
  const counts = { blocking: 0, unproven: 0, refuted: 0, advisory: 0, rejected: 0 };
  for (const item of classified) counts[item.class] += 1;
  return {
    classified,
    counts,
    blockingFindings: classified.filter((item) => item.class === 'blocking').map((item) => summary(item.finding)),
  };
}

// A consolidated round lists the whole panel; a closure or Gateway B delta lists the
// one reviewer that checked the fix.
function assertReviewers(block, { round, panel }) {
  const reviewers = block.reviewers;
  if (!Array.isArray(reviewers) || reviewers.length === 0
    || reviewers.some((item) => !item || !text(item.id) || !text(item.executor) || !text(item.model))) {
    throw new Error('[cc-nexs] review block must list its reviewers as {id, executor, model}');
  }
  const ids = reviewers.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('[cc-nexs] review block lists a reviewer twice');
  const byId = new Map(panel.map((item) => [item.id, item]));
  for (const item of reviewers) {
    const member = byId.get(item.id);
    if (!member) throw new Error(`[cc-nexs] review block lists ${item.id}, which is not in review.panel`);
    if (member.executor !== item.executor) throw new Error(`[cc-nexs] reviewer ${item.id} is ${member.executor} in review.panel, not ${item.executor}`);
  }
  if (round === 'consolidated') {
    const missing = panel.filter((item) => !ids.includes(item.id)).map((item) => item.id);
    if (missing.length) throw new Error(`[cc-nexs] the consolidated Review is missing panel reviewer(s) ${missing.join(', ')}`);
  } else if (reviewers.length !== 1) {
    throw new Error(`[cc-nexs] a ${round} Review uses exactly one reviewer`);
  }
}

export function readReviewFindings(documentText, { round, source, panel, notReproduced = [] }) {
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
  assertReviewers(block, { round, panel });
  const reviewerIds = new Set(block.reviewers.map((item) => item.id));
  return { ...classifyReviewFindings(block.findings ?? [], { notReproduced, reviewerIds }), reviewers: block.reviewers };
}

export function hasReviewBlock(documentText) {
  return [...String(documentText || '').matchAll(BLOCK)].length > 0;
}
