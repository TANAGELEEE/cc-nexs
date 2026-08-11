import { createHash } from 'node:crypto';

const START_MARKER = '<!-- IMPLEMENTATION-OWNERSHIP:START -->';
const END_MARKER = '<!-- IMPLEMENTATION-OWNERSHIP:END -->';
const REQUIRED_COLUMNS = [
  'assignment',
  'sprint',
  'surface',
  'ac',
  'repository',
  'allowed paths',
  'depends on',
  'validation',
  'wave',
];

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function splitList(value) {
  if (!value || /^(?:-|none|无)$/i.test(value.trim())) return [];
  return value.split(/\s*(?:,|<br\s*\/?>)\s*/i).map((item) => item.trim()).filter(Boolean);
}

function normalizeAllowedPath(value, assignment) {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`[cc-nexs] implementation assignment ${assignment} has an absolute or empty allowed path`);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`[cc-nexs] implementation assignment ${assignment} allowed path escapes its repository`);
  }
  return normalized;
}

function validateAssignments(assignments, {
  repositories = null,
  acceptanceCriteria = null,
  acceptanceSprints = null,
  mode = null,
} = {}) {
  const allowedRepositories = repositories ? new Set(repositories) : null;
  const knownCriteria = acceptanceCriteria ? new Set(acceptanceCriteria) : null;
  const byId = new Map();
  for (const item of assignments) {
    if (!/^IMP-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(item.id)) {
      throw new Error(`[cc-nexs] invalid implementation assignment id: ${item.id || '<missing>'}`);
    }
    if (byId.has(item.id)) throw new Error(`[cc-nexs] duplicate implementation assignment: ${item.id}`);
    byId.set(item.id, item);
    if (!/^M\d+$/.test(item.sprint)) throw new Error(`[cc-nexs] implementation assignment ${item.id} has invalid sprint`);
    if (['fast', 'lite'].includes(mode) && item.sprint !== 'M1') {
      throw new Error(`[cc-nexs] ${mode} implementation assignment ${item.id} must belong to M1`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.repository)) {
      throw new Error(`[cc-nexs] implementation assignment ${item.id} has invalid repository`);
    }
    if (allowedRepositories && !allowedRepositories.has(item.repository)) {
      throw new Error(`[cc-nexs] implementation assignment ${item.id} references unknown repository ${item.repository}`);
    }
    if (!item.surface || !item.validation || item.allowedPaths.length === 0 || item.acceptanceCriteria.length === 0) {
      throw new Error(`[cc-nexs] implementation assignment ${item.id} is incomplete`);
    }
    for (const criterion of item.acceptanceCriteria) {
      if (!/^AC-(?:NF-)?\d{3}$/.test(criterion) || (knownCriteria && !knownCriteria.has(criterion))) {
        throw new Error(`[cc-nexs] implementation assignment ${item.id} references unknown acceptance criterion ${criterion}`);
      }
      const declaredSprint = acceptanceSprints?.get(criterion);
      if (declaredSprint && declaredSprint !== item.sprint) {
        throw new Error(`[cc-nexs] implementation assignment ${item.id} assigns ${criterion} to ${item.sprint}, but the acceptance criterion belongs to ${declaredSprint}`);
      }
    }
    if (!Number.isInteger(item.wave) || item.wave < 1) {
      throw new Error(`[cc-nexs] implementation assignment ${item.id} has invalid wave`);
    }
  }

  if (knownCriteria) {
    const covered = new Set(assignments.flatMap((item) => item.acceptanceCriteria));
    const missing = [...knownCriteria].filter((criterion) => !covered.has(criterion));
    if (missing.length > 0) throw new Error(`[cc-nexs] implementation ownership does not cover acceptance criteria: ${missing.join(', ')}`);
  }

  for (const item of assignments) {
    for (const dependency of item.dependsOn) {
      const required = byId.get(dependency);
      if (!required) throw new Error(`[cc-nexs] implementation assignment ${item.id} depends on unknown ${dependency}`);
      if (required.sprint !== item.sprint || required.wave >= item.wave) {
        throw new Error(`[cc-nexs] implementation dependency ${dependency} must be in an earlier wave of ${item.sprint}`);
      }
    }
  }

  for (let i = 0; i < assignments.length; i += 1) {
    for (let j = i + 1; j < assignments.length; j += 1) {
      const left = assignments[i];
      const right = assignments[j];
      if (left.sprint !== right.sprint || left.wave !== right.wave || left.repository !== right.repository) continue;
      throw new Error(`[cc-nexs] same-wave implementation assignments ${left.id} and ${right.id} share repository ${left.repository}; one assigned worktree must be serialized`);
    }
  }
}

function acceptanceContract(specText) {
  const criteria = new Set();
  const sprints = new Map();
  const lines = specText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    const header = tableCells(lines[index]);
    const criterionIndex = header.findIndex((cell) => /^AC-ID$/i.test(cell));
    if (criterionIndex === -1) continue;
    const sprintIndex = header.findIndex((cell) => /^(?:(?:所属|关联)\s*)?Sprint$/i.test(cell));
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      const cells = tableCells(lines[index]);
      const criterion = cells[criterionIndex];
      if (/^AC-(?:NF-)?\d{3}$/.test(criterion || '')) {
        criteria.add(criterion);
        const declaredSprint = sprintIndex === -1 ? null : cells[sprintIndex];
        if (declaredSprint && !/^M\d+$/.test(declaredSprint)) {
          throw new Error(`[cc-nexs] acceptance criterion ${criterion} has invalid sprint ${declaredSprint}`);
        }
        if (declaredSprint) {
          const previous = sprints.get(criterion);
          if (previous && previous !== declaredSprint) {
            throw new Error(`[cc-nexs] acceptance criterion ${criterion} declares conflicting sprints`);
          }
          sprints.set(criterion, declaredSprint);
        }
      }
      index += 1;
    }
    index -= 1;
  }
  return { criteria: [...criteria], sprints };
}

function contiguousImplementationSprints(acceptanceSprints) {
  const numbers = [...new Set([...acceptanceSprints.values()].map((sprint) => Number(sprint.slice(1))))].sort((left, right) => left - right);
  if (numbers.length === 0) return [];
  const expected = Array.from({ length: numbers.at(-1) }, (_, index) => index + 1);
  if (numbers.length !== expected.length || numbers.some((value, index) => value !== expected[index])) {
    throw new Error(`[cc-nexs] implementation Sprints must be contiguous from M1, found: ${numbers.map((value) => `M${value}`).join(', ')}`);
  }
  return expected.map((value) => `M${value}`);
}

export function parseImplementationOwnership(specText, { sprint = null, repositories = null, mode = null } = {}) {
  const start = specText.indexOf(START_MARKER);
  const end = specText.indexOf(END_MARKER);
  if (start === -1 && end === -1) return { contractVersion: 0, assignments: [] };
  if (specText.split(START_MARKER).length !== 2 || specText.split(END_MARKER).length !== 2) {
    throw new Error('[cc-nexs] implementation ownership requires exactly one ordered marker pair');
  }
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('[cc-nexs] malformed IMPLEMENTATION-OWNERSHIP markers');
  }

  const lines = specText.slice(start + START_MARKER.length, end).split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line.startsWith('|'));
  if (lines.length < 3) throw new Error('[cc-nexs] implementation ownership table is missing rows');
  const columns = tableCells(lines[0]).map((cell) => cell.toLowerCase());
  if (columns.length !== REQUIRED_COLUMNS.length || REQUIRED_COLUMNS.some((column, index) => columns[index] !== column)) {
    throw new Error(`[cc-nexs] implementation ownership columns must be: ${REQUIRED_COLUMNS.join(' | ')}`);
  }

  const assignments = lines.slice(2).map((line) => {
    const cells = tableCells(line);
    if (cells.length !== REQUIRED_COLUMNS.length) throw new Error('[cc-nexs] implementation ownership row has the wrong number of columns');
    const [id, rowSprint, surface, criteria, repository, paths, dependencies, validation, waveText] = cells;
    return {
      id,
      sprint: rowSprint,
      surface,
      acceptanceCriteria: splitList(criteria),
      repository,
      allowedPaths: splitList(paths).map((path) => normalizeAllowedPath(path, id)),
      dependsOn: splitList(dependencies),
      validation,
      wave: Number(waveText),
    };
  });
  const acceptance = acceptanceContract(specText);
  const acceptanceCriteria = acceptance.criteria;
  if (acceptanceCriteria.length === 0) throw new Error('[cc-nexs] implementation ownership requires acceptance criteria in spec.md');
  if (['fast', 'lite', 'full'].includes(mode)) {
    const missingSprint = acceptanceCriteria.filter((criterion) => !acceptance.sprints.has(criterion));
    if (missingSprint.length > 0) {
      throw new Error(`[cc-nexs] implementation ownership requires an explicit Sprint for every acceptance criterion: ${missingSprint.join(', ')}`);
    }
  }
  validateAssignments(assignments, {
    repositories,
    acceptanceCriteria,
    acceptanceSprints: acceptance.sprints,
    mode,
  });
  const sprints = contiguousImplementationSprints(acceptance.sprints);

  return {
    contractVersion: 1,
    sprints,
    sprintTotal: sprints.length,
    assignments: sprint ? assignments.filter((item) => item.sprint === sprint) : assignments,
  };
}

export function implementationWaves(assignments, { maxParallel = 4 } = {}) {
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 16) {
    throw new Error('[cc-nexs] implementation max parallel must be between 1 and 16');
  }
  validateAssignments(assignments);
  const grouped = new Map();
  for (const item of assignments) {
    if (!grouped.has(item.wave)) grouped.set(item.wave, []);
    grouped.get(item.wave).push(item);
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([wave, items]) => ({
    wave,
    batches: Array.from({ length: Math.ceil(items.length / maxParallel) }, (_, index) => (
      items.slice(index * maxParallel, (index + 1) * maxParallel)
    )),
  }));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function specApprovalScope(specText) {
  const headings = [...specText.matchAll(/^##\s+变更记录\s*$/gm)];
  if (headings.length === 0) return specText.trim();
  if (headings.length !== 1) throw new Error('[cc-nexs] spec.md requires at most one change-log section');
  const heading = headings[0];
  const before = specText.slice(0, heading.index).trim();
  const after = specText.slice(heading.index + heading[0].length).trim();
  if (/^##\s+/m.test(after)) {
    throw new Error('[cc-nexs] spec.md change log must be the final H2 section');
  }
  if (!after) return `${before}\n\n## 变更记录`;
  const lines = after.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.some((line) => !line.startsWith('|'))) {
    throw new Error('[cc-nexs] spec.md change log may contain only its Markdown table');
  }
  const header = tableCells(lines[0]);
  if (!header.includes('日期') || !header.includes('变更内容') || !header.includes('操作人')) {
    throw new Error('[cc-nexs] spec.md change log has an invalid table header');
  }
  const separator = tableCells(lines[1]);
  if (separator.length !== header.length || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error('[cc-nexs] spec.md change log has an invalid table separator');
  }
  for (const line of lines.slice(2)) {
    if (tableCells(line).length !== header.length) {
      throw new Error('[cc-nexs] spec.md change log row has the wrong number of columns');
    }
  }
  return `${before}\n\n## 变更记录\n${lines[0]}\n${lines[1]}`;
}

export function implementationApprovalBinding(specText, { repositories = null, mode = null } = {}) {
  const parsed = parseImplementationOwnership(specText, { repositories, mode });
  return {
    contract_version: parsed.contractVersion,
    spec_scope_sha256: sha256(specApprovalScope(specText)),
    implementation_sha256: sha256(JSON.stringify(parsed.assignments)),
    sprint_contract_version: parsed.contractVersion === 1 ? 1 : 0,
    ...(parsed.contractVersion === 1 && {
      sprints: parsed.sprints,
      sprint_total: parsed.sprintTotal,
    }),
  };
}

function assertApprovedSprintProgress(progress, approved, current) {
  if (current.contract_version === 1) {
    const hasApprovedSprintContract = approved.sprint_contract_version !== undefined
      || approved.sprint_total !== undefined || approved.sprints !== undefined;
    if (!hasApprovedSprintContract) {
      throw new Error('[cc-nexs] approved G1 binding predates the implementation Sprint contract; recover at G1 or re-approve');
    }
    if (approved.sprint_contract_version !== 1
      || approved.sprint_total !== current.sprint_total
      || JSON.stringify(approved.sprints) !== JSON.stringify(current.sprints)) {
      throw new Error('[cc-nexs] approved implementation Sprint contract changed after G1');
    }
  }
  const expectedTotal = Number.isInteger(approved.sprint_total) && approved.sprint_total > 0
    ? approved.sprint_total
    : null;
  if (expectedTotal === null) return;
  const actualTotal = progress?.sprint?.total;
  const actualCurrent = progress?.sprint?.current;
  if (actualTotal !== expectedTotal
    || !Number.isInteger(actualCurrent) || actualCurrent < 1 || actualCurrent > expectedTotal) {
    throw new Error(`[cc-nexs] progress Sprint state drifted from approved G1 binding: expected current 1..${expectedTotal}/total ${expectedTotal}, found ${actualCurrent}/${actualTotal}`);
  }
  const stateSprint = String(progress?.state || '').match(/^SPRINT_(\d+)_/);
  if (stateSprint && Number(stateSprint[1]) !== actualCurrent) {
    throw new Error(`[cc-nexs] progress Sprint current ${actualCurrent} does not match state ${progress.state}`);
  }
}

export function assertImplementationApprovalCurrent(progress, specText, {
  repositories = null,
  mode = null,
  validateProgressSprint = true,
} = {}) {
  const approved = progress?.gates?.g1?.binding;
  if (!approved) {
    const parsed = parseImplementationOwnership(specText, { repositories, mode });
    if (parsed.contractVersion !== 0) {
      throw new Error('[cc-nexs] G1 approval predates implementation ownership; return to G1 and re-approve the spec');
    }
    return { ...parsed, legacy: true };
  }
  const current = implementationApprovalBinding(specText, { repositories, mode });
  if (approved.spec_scope_sha256 !== current.spec_scope_sha256
    || approved.implementation_sha256 !== current.implementation_sha256
    || approved.contract_version !== current.contract_version) {
    throw new Error('[cc-nexs] approved spec or implementation ownership changed after G1');
  }
  if (validateProgressSprint) assertApprovedSprintProgress(progress, approved, current);
  else if (current.contract_version === 1) {
    const hasApprovedSprintContract = approved.sprint_contract_version !== undefined
      || approved.sprint_total !== undefined || approved.sprints !== undefined;
    if (hasApprovedSprintContract && (approved.sprint_contract_version !== 1
      || approved.sprint_total !== current.sprint_total
      || JSON.stringify(approved.sprints) !== JSON.stringify(current.sprints))) {
      throw new Error('[cc-nexs] approved implementation Sprint contract changed after G1');
    }
  }
  return { ...parseImplementationOwnership(specText, { repositories, mode }), legacy: current.contract_version === 0 };
}

export const IMPLEMENTATION_OWNERSHIP_MARKERS = { start: START_MARKER, end: END_MARKER };
