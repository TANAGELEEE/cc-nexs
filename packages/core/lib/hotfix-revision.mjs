import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';
import { extractHotfixScope, hotfixScopeBinding, resolveHotfixDocument } from './hotfix-contract.mjs';
import { hotfixTemplates } from './hotfix-init.mjs';
import { extractLocalVerificationChecks } from './local-evidence.mjs';
import { readProgressV2, writeProgressV2 } from './progress-v2.mjs';

export function reviseHotfix({ cwd = process.cwd(), featureId, progressPath = null, reason, authorizationEvidence, promoteLean = false, actor = 'orchestrator' } = {}) {
  if (typeof reason !== 'string' || !reason.trim() || typeof authorizationEvidence !== 'string' || !authorizationEvidence.trim()) {
    throw new Error('[cc-nexs] revise-hotfix requires a reason and the existing user authorization evidence');
  }
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const progress = readProgressV2(progressFile);
  if (progress.mode !== 'hotfix' || !progress.hotfix?.scope_binding) throw new Error('[cc-nexs] revise-hotfix requires a bound Hotfix');
  if (['COMPLETE', 'HOTFIX_BASE_MERGING'].includes(progress.state) || progress.delivery?.base?.status === 'succeeded') throw new Error('[cc-nexs] released Hotfix cannot be revised');
  if (['running', 'deploying', 'awaiting_receipt'].some((status) => progress.delivery?.test?.status === status || progress.delivery?.test?.attempts?.at(-1)?.status === status)) throw new Error('[cc-nexs] finish the active test release before revising the Hotfix');
  const document = resolveHotfixDocument(progress, dirname(progressFile));
  const previous = { mode: progress.mode, state: progress.state, hotfix: progress.hotfix, gates: progress.gates, review: progress.review, local_verification: progress.local_verification };
  const timestamp = new Date().toISOString();
  let targetFile = progressFile;
  let promotion = null;
  if (promoteLean) {
    const targetDir = join(dirname(document), `${basename(document, '.md')}.lean`);
    if (existsSync(targetDir)) throw new Error('[cc-nexs] Lean continuation directory already exists; inspect it before retrying');
    const templateRoot = hotfixTemplates('lean');
    const documents = Object.fromEntries(['requirements.md', 'plan.md', 'progress.md'].map((name) => [name,
      readFileSync(join(templateRoot, name), 'utf8').replaceAll('{编号}', progress.feature.id).replaceAll('{需求短名}', progress.feature.slug),
    ]));
    documents['requirements.md'] += `\n原始 BUG：[${basename(document)}](../${basename(document)})。范围升级原因：${reason.trim()}\n`;
    const configFile = join(dirname(progressFile), 'config.json');
    const newConfig = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
    newConfig.mode = 'lean';
    const historyFile = join(dirname(progressFile), 'progress.hotfix-history.json');
    const historyMarkdown = join(dirname(progressFile), 'progress.hotfix-history.md');
    if (existsSync(historyFile) || existsSync(historyMarkdown)) throw new Error('[cc-nexs] Hotfix history already exists; inspect the prior promotion');
    promotion = { targetDir, documents, newConfig, historyFile, historyMarkdown };
    targetFile = join(targetDir, 'progress.json');
    progress.mode = 'lean';
    progress.state = 'PLANNING';
  } else {
    const binding = hotfixScopeBinding(dirname(progressFile), progress);
    if (progress.hotfix_document && !extractLocalVerificationChecks(extractHotfixScope(readFileSync(document, 'utf8')).raw).length) {
      throw new Error('[cc-nexs] fill the BUG local verification matrix before rebinding');
    }
    progress.hotfix = { ...progress.hotfix, severity: binding.severity, related_feature: binding.related_feature, scope_binding: binding, scope_bound_at: timestamp, review_required: true };
    progress.state = 'HOTFIX_IMPLEMENTING';
  }
  progress.gates = { ...progress.gates, plan: { approved: false, binding: null }, release: { approved: false, binding: null } };
  progress.local_verification = { ...progress.local_verification, status: 'idle', candidate_fingerprint: null, context: null };
  progress.review = { status: 'idle', candidate_fingerprint: null, reviewed_commits: {}, blocking_findings: [], closure_attempts: 0, gateway_b_delta_attempts: 0 };
  progress.delivery.test.status = 'idle';
  for (const attempt of progress.delivery.test.attempts) {
    attempt.invalidated_at ||= timestamp;
    attempt.invalidation_reason ||= 'Hotfix scope revision requires fresh acceptance';
  }
  progress.counters.fix_per_bug = { ...progress.counters.fix_per_bug, HOTFIX_TEST: 0 };
  progress.updated_at = timestamp;
  progress.revision += 1;
  progress.events.push({ id: randomUUID(), sequence: progress.revision, timestamp, type: promoteLean ? 'hotfix.promoted_to_lean' : 'hotfix.scope_revised', actor,
    from: previous.state, to: progress.state, reason: reason.trim(), data: { authorization_evidence: authorizationEvidence.trim(), previous, document, progress_file: targetFile } });
  if (promotion) {
    const { targetDir, documents, newConfig, historyFile, historyMarkdown } = promotion;
    const staging = mkdtempSync(`${targetDir}.tmp-`);
    const oldMarkdown = join(dirname(progressFile), 'progress.md');
    let installed = false;
    let archivedMarkdown = false;
    try {
      for (const [name, text] of Object.entries(documents)) writeFileSync(join(staging, name), text);
      writeFileSync(join(staging, 'config.json'), `${JSON.stringify(newConfig, null, 2)}\n`);
      writeProgressV2(join(staging, 'progress.json'), progress);
      renameSync(staging, targetDir);
      installed = true;
      if (existsSync(oldMarkdown)) { renameSync(oldMarkdown, historyMarkdown); archivedMarkdown = true; }
      renameSync(progressFile, historyFile);
    } catch (error) {
      if (archivedMarkdown) renameSync(historyMarkdown, oldMarkdown);
      rmSync(installed ? targetDir : staging, { recursive: true, force: true });
      throw error;
    }
  } else writeProgressV2(targetFile, progress);
  return { kind: 'hotfix-revision', feature: progress.feature, mode: progress.mode, state: progress.state, progressFile: targetFile, document };
}
