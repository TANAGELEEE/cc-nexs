import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLAN_SCOPE_MARKERS } from './plan-contract.mjs';

export function assertReleaseChangeDocuments(featureDir, { scope = false } = {}) {
  const required = [join(featureDir, 'plan.md'), ...(scope ? [join(featureDir, 'requirements.md')] : [])];
  const missing = required.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`[cc-nexs] Gateway B document is missing: ${missing.join(', ')}`);
  }
}

export function appendPlanChange(file, request) {
  const heading = '## Gateway B 变更请求';
  const header = '| ID | 类型 | 提出人 | 影响 AC | 允许修改路径 | 意见 | 状态 |\n|---|---|---|---|---|---|---|';
  const row = `| ${cell(request.id)} | ${cell(request.kind)} | ${cell(request.requested_by)} | ${cell(request.affected_acs.join(', ') || '-')} | ${cell(request.paths.join(', ') || '-')} | ${cell(request.feedback)} | ${cell(request.status)} |`;
  appendTableRow(file, heading, header, row);
}

const PLAN_CHANGE_HEADINGS = ['## 计划变更', '## 計劃變更', '## Plan Changes'];

// Written only after the approval markers, so the Gateway A hash cannot move.
export function appendPlanAmendment(file, amendment) {
  const text = readFileSync(file, 'utf8');
  const scopeEnd = text.indexOf(PLAN_SCOPE_MARKERS.END);
  const approved = text.slice(0, scopeEnd);
  const log = text.slice(scopeEnd);
  const heading = PLAN_CHANGE_HEADINGS.find((item) => log.includes(item)) || PLAN_CHANGE_HEADINGS[0];
  const header = '| 日期 | 变更 | 是否影响批准范围 | 动作 |\n|---|---|---|---|';
  const change = `${amendment.id} [${amendment.target}] ${amendment.acs.join(', ')}: ${amendment.reason} (${amendment.paths.join(', ')})`;
  const row = `| ${amendment.requested_at.slice(0, 10)} | ${cell(change)} | no | ${cell(amendment.status)} |`;
  writeFileSync(file, `${approved}${withTableRow(log, heading, header, row)}`, 'utf8');
}

export function syncPlanAmendmentStatus(file, amendment) {
  const prefix = `| ${amendment.requested_at.slice(0, 10)} | ${amendment.id} [`;
  const next = readFileSync(file, 'utf8').split('\n').map((line) => {
    if (!line.startsWith(prefix)) return line;
    const columns = line.split('|');
    columns[columns.length - 2] = ` ${amendment.status} `;
    return columns.join('|');
  }).join('\n');
  writeFileSync(file, next, 'utf8');
}

export function appendRequirementChange(file, request) {
  const heading = '## 需求变更';
  const header = '| 日期 | 变更 | 原因 | 影响 AC |\n|---|---|---|---|---|';
  const date = request.requested_at.slice(0, 10);
  const row = `| ${date} | ${cell(request.id)} | ${cell(request.feedback)} | ${cell(request.affected_acs.join(', ') || '-')} |`;
  appendTableRow(file, heading, header, row);
}

export function syncPlanChangeStatuses(file, requests = []) {
  if (!existsSync(file) || requests.length === 0) return false;
  const statuses = new Map(requests.map((request) => [request.id, request.status]));
  const text = readFileSync(file, 'utf8');
  let changed = false;
  const next = text.split('\n').map((line) => {
    if (!line.startsWith('| gateway-b-')) return line;
    const columns = line.split('|');
    const id = columns[1]?.trim();
    const status = statuses.get(id);
    if (!status || columns.length < 9 || columns[7].trim() === status) return line;
    columns[7] = ` ${status} `;
    changed = true;
    return columns.join('|');
  }).join('\n');
  if (changed) writeFileSync(file, next, 'utf8');
  return changed;
}

export function appendHotfixChange(file, request) {
  const heading = '## Gateway B 变更请求';
  const header = '| ID | 类型 | 提出人 | 允许修改路径 | 意见 | 状态 |\n|---|---|---|---|---|---|';
  const row = `| ${cell(request.id)} | ${cell(request.kind)} | ${cell(request.requested_by)} | ${cell(request.paths.join(', ') || '-')} | ${cell(request.feedback)} | ${cell(request.status)} |`;
  appendTableRow(file, heading, header, row);
}

export function syncHotfixChangeStatuses(file, requests = []) {
  if (!existsSync(file) || requests.length === 0) return false;
  const statuses = new Map(requests.map((request) => [request.id, request.status]));
  const text = readFileSync(file, 'utf8');
  let changed = false;
  const next = text.split('\n').map((line) => {
    if (!line.startsWith('| gateway-b-')) return line;
    const columns = line.split('|');
    const id = columns[1]?.trim();
    const status = statuses.get(id);
    if (!status || columns.length < 8 || columns[6].trim() === status) return line;
    columns[6] = ` ${status} `;
    changed = true;
    return columns.join('|');
  }).join('\n');
  if (changed) writeFileSync(file, next, 'utf8');
  return changed;
}

function appendTableRow(file, heading, header, row) {
  writeFileSync(file, withTableRow(readFileSync(file, 'utf8'), heading, header, row), 'utf8');
}

function withTableRow(text, heading, header, row) {
  const headingIndex = text.indexOf(heading);
  if (headingIndex === -1) return `${text.trimEnd()}\n\n${heading}\n\n${header}\n${row}\n`;
  const nextHeading = text.indexOf('\n## ', headingIndex + heading.length);
  const insertAt = nextHeading === -1 ? text.length : nextHeading;
  return `${text.slice(0, insertAt).trimEnd()}\n${row}\n\n${text.slice(insertAt).replace(/^\n+/, '')}`;
}

function cell(value) {
  return String(value).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}
