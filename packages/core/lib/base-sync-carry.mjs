// A tested candidate that conflicts with a moved base is synced (base merged into the
// feature branch, conflicts resolved), built locally, and released through the MR; it
// is not reviewed or tested again. Syncing a candidate clears its evidence, so the
// tested candidate's evidence is kept here first, and is carried over only when Git
// proves the new candidate is that candidate plus the base and nothing else, and the
// new candidate passed local verification.

import { execFileSync } from 'node:child_process';

import { assertRecordedLocalVerification } from './local-evidence.mjs';
import { appendMutationEvent, candidateFingerprint, readProgressV2, writeProgressV2 } from './progress-v2.mjs';

const LOCAL_READY = { lean: ['passed', 'deferred_to_test'], hotfix: ['passed', 'deferred_to_test'] };

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// The evidence worth carrying: the latest verified test attempt of the candidate being
// synced, with its Review and any release approval for that same candidate.
export function captureBaseSyncCarry(progress, source) {
  const fingerprint = candidateFingerprint(source);
  const attempt = progress.delivery?.test?.attempts?.at(-1);
  if (!attempt || attempt.invalidated_at || attempt.status !== 'verified' || attempt.fingerprint !== fingerprint) {
    // A candidate that is itself a carried sync keeps the original tested evidence when
    // the base moves again; the proof walks the chain of base merges back to it.
    if (!baseSyncCarryReady(progress) || progress.base_sync.to_fingerprint !== fingerprint) return null;
    const gate = progress.gates?.release;
    const releaseGate = progress.base_sync.release_gate || (gate?.approved && gate.binding?.candidate_fingerprint === fingerprint ? structuredClone(gate) : null);
    return { ...progress.base_sync, release_gate: releaseGate, to_source: null, to_fingerprint: null };
  }
  const review = progress.review?.status === 'passed' && progress.review.candidate_fingerprint === fingerprint ? structuredClone(progress.review) : null;
  const gate = progress.gates?.release;
  const releaseGate = gate?.approved && gate.binding?.candidate_fingerprint === fingerprint ? structuredClone(gate) : null;
  return { from_fingerprint: fingerprint, from_source: { ...source }, test_attempt: attempt.id, review, release_gate: releaseGate, to_source: null, to_fingerprint: null };
}

export function recordBaseSyncCarry(file, carry) {
  const progress = readProgressV2(file);
  progress.base_sync = carry;
  appendMutationEvent(progress, { type: 'base.sync_carry_recorded', actor: 'git-custodian', data: carry && { from_fingerprint: carry.from_fingerprint, test_attempt: carry.test_attempt, approved: Boolean(carry.release_gate) } });
  writeProgressV2(file, progress);
  return progress;
}

// Once the synced candidate refs exist, name the candidate the evidence may carry to.
export function completeBaseSyncCarry(file, source) {
  const progress = readProgressV2(file);
  if (!progress.base_sync) return progress;
  progress.base_sync = { ...progress.base_sync, to_source: { ...source }, to_fingerprint: candidateFingerprint(source) };
  appendMutationEvent(progress, { type: 'base.sync_carry_completed', actor: 'git-custodian', data: { to_fingerprint: progress.base_sync.to_fingerprint } });
  writeProgressV2(file, progress);
  return progress;
}

// Cheap check for the state machine: the current local verification is for the synced candidate.
export function baseSyncCarryReady(progress) {
  const carry = progress.base_sync;
  const local = progress.local_verification;
  return Boolean(carry?.to_fingerprint && local?.candidate_fingerprint === carry.to_fingerprint
    && (LOCAL_READY[progress.mode] || []).includes(local.status));
}

// The carry, proven: every repository is the tested commit, or a merge whose first parent
// is the tested commit and whose second parent is on the base branch; and the synced
// candidate passed local verification. Returns null when the current candidate is not that.
export function provenBaseSyncCarry(context, { expectedChecks = [] } = {}) {
  const carry = context.progress.base_sync;
  if (!carry?.to_fingerprint || carry.to_fingerprint !== candidateFingerprint(context.source)) return null;
  if (!baseSyncCarryReady(context.progress)) return null;
  for (const item of context.repositories) {
    const tested = carry.from_source[item.id];
    if (!tested) return null;
    const base = item.assignment.base_branch || item.repository.base_branch;
    let commit = item.sourceCommit;
    for (let merges = 0; commit !== tested; merges += 1) {
      if (merges >= 10) return null;
      const parents = git(item.repository.absolute_path, ['show', '-s', '--format=%P', commit]).split(' ').filter(Boolean);
      if (parents.length !== 2) return null;
      try { git(item.repository.absolute_path, ['merge-base', '--is-ancestor', parents[1], `refs/remotes/origin/${base}`]); } catch { return null; }
      commit = parents[0];
    }
  }
  if (Object.keys(carry.from_source).length !== context.repositories.length) return null;
  assertRecordedLocalVerification(context.progress, { source: context.source, fingerprint: carry.to_fingerprint, expectedChecks });
  return carry;
}
