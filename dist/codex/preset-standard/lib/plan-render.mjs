import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { resolveFeatureProgress } from './approval-command.mjs';

export function renderLeanPlan({ cwd = process.cwd(), featureId, progressPath = null } = {}) {
  const progressFile = resolveFeatureProgress({ cwd, featureId, progressPath });
  const reqDir = dirname(progressFile);
  const progress = JSON.parse(readFileSync(progressFile, 'utf8'));
  if (progress.mode !== 'lean') throw new Error(`[cc-nexs] HTML plan rendering requires lean mode, found ${progress.mode}`);
  const markdown = readFileSync(join(reqDir, 'plan.md'), 'utf8');
  const outputDir = join(tmpdir(), 'cc-nexs-rendered-plans');
  mkdirSync(outputDir, { recursive: true });
  const output = join(outputDir, `${progress.feature.id}-${progress.feature.slug}-plan.html`);
  const title = `${progress.feature.id}.${progress.feature.slug} Plan`;
  writeFileSync(output, htmlDocument(title, markdown), 'utf8');
  return { kind: 'plan-render', feature: progress.feature, output, source: join(reqDir, 'plan.md') };
}

function htmlDocument(title, markdown) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif;max-width:1120px;margin:0 auto;padding:32px;color:#1f2937;background:#f8fafc;line-height:1.65}main{background:white;border:1px solid #e5e7eb;border-radius:14px;padding:32px;box-shadow:0 8px 24px #0f172a0d}h1,h2,h3{color:#0f172a}h2{border-bottom:1px solid #e5e7eb;padding-bottom:6px}table{border-collapse:collapse;width:100%;display:block;overflow:auto}th,td{border:1px solid #d1d5db;padding:7px 10px;text-align:left;vertical-align:top}th{background:#f1f5f9}code,pre{font-family:ui-monospace,SFMono-Regular,monospace}code{background:#f1f5f9;padding:.1em .3em;border-radius:4px}pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto}.meta{color:#64748b;font-size:14px}</style></head><body><main><div class="meta">Generated from ${escapeHtml(basename('plan.md'))}; edit the Markdown source only.</div>${markdownToHtml(markdown)}</main></body></html>`;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let code = false;
  let list = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      if (list) { out.push('</ul>'); list = false; }
      out.push(code ? '</code></pre>' : '<pre><code>');
      code = !code;
      continue;
    }
    if (code) { out.push(`${escapeHtml(line)}\n`); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (list) { out.push('</ul>'); list = false; }
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\|.*\|$/.test(line) && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[index + 1] || '')) {
      if (list) { out.push('</ul>'); list = false; }
      const headers = cells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && /^\|.*\|$/.test(lines[index])) { rows.push(cells(lines[index])); index += 1; }
      index -= 1;
      out.push(`<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const item = line.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }
    if (list) { out.push('</ul>'); list = false; }
    if (!line.trim() || line.startsWith('<!--')) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  if (code) out.push('</code></pre>');
  return out.join('\n');
}

function cells(line) {
  return line.slice(1, -1).split('|').map((cell) => cell.trim());
}

function inline(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
