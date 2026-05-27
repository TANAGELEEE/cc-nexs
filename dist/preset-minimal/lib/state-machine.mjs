// cc-nexs core: state machine.
// Pure logic: given a state + counters + role-list, decide next state and the role/action to invoke.
// Side-effects (calling reviewer, writing progress) live in the orchestrator command, not here.

const TERMINAL = new Set(['COMPLETE']);
const HUMAN_GATE = 'SPEC_PENDING_HUMAN';

/**
 * Build a state graph specialized to a preset's enabled roles.
 * Roles act as "stations"; the SOP backbone is fixed but stations may be skipped if the
 * corresponding role is not enabled.
 *
 * Two state-machine flavors are supported via the `mode` parameter:
 *
 *   mode='full' (default) — five-role SOP with sprint slicing:
 *     INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *       → SPRINT_<N>_DEV → SPRINT_<N>_REVIEW → SPRINT_<N>_TEST → [SPRINT_<N>_FIX → SPRINT_<N>_REGRESSION]
 *       → SPRINT_<N>_EVAL → SPRINT_<N>_DONE → … → ALL_SPRINTS_DONE → FINAL_EVAL → COMPLETE
 *
 *   mode='fast' — three-role single-sprint merged pipeline:
 *     INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *       → BUILD → TEST → [FIX → REGRESSION]* → ACCEPT → COMPLETE
 *     Roles: fullstack (replaces planner+tech-lead), reviewer (replaces sa+evaluator),
 *     verifier (replaces qa cases+run+regression).
 *
 * Role mapping (role identifier in preset → state slot):
 *   planner | pm                 → drafts spec       (full)
 *   tech-lead | developer | dev  → implements code   (full)
 *   sa | reviewer                → reviews spec / cases / code
 *   qa | verifier                → writes cases, runs tests, regression
 *   evaluator                    → contract-driven acceptance scoring (full only)
 *   fullstack                    → spec + code + fix (fast only)
 *
 * If `qa` is missing, tests are folded into reviewer responsibilities.
 * If `evaluator` is missing, the final acceptance step is folded into reviewer.
 */
export function nextStep({
  state,
  counters = {},
  thresholds = { review_revision: 3, fix_per_bug: 3, evaluator_reject: 2 },
  enabledRoles,
  sprint = { current: 0, total: 0 },
  humanGateApproved = false,
  workflow = {},
  mode = 'full',
}) {
  if (mode === 'fast') {
    return nextStepFast({ state, counters, thresholds, enabledRoles, humanGateApproved });
  }
  return nextStepFull({ state, counters, thresholds, enabledRoles, sprint, humanGateApproved, workflow });
}

function nextStepFull({
  state,
  counters,
  thresholds,
  enabledRoles,
  sprint,
  humanGateApproved,
  workflow,
}) {
  const has = (r) => enabledRoles.includes(r);
  const planner = has('planner') ? 'planner' : has('pm') ? 'pm' : null;
  const dev = has('tech-lead') ? 'tech-lead' : has('developer') ? 'developer' : has('dev') ? 'dev' : null;
  const reviewer = has('sa') ? 'sa' : has('reviewer') ? 'reviewer' : null;
  const qa = has('qa') ? 'qa' : reviewer;
  const evaluator = has('evaluator') ? 'evaluator' : reviewer;

  // Circuit breakers ----------------------------------------------------------
  if (counters.review_revision >= thresholds.review_revision) {
    return { next: 'SPEC_REVIEWING', role: planner, action: 'revise_spec', circuitBreaker: 'review' };
  }
  if (counters.evaluator_reject >= thresholds.evaluator_reject) {
    return { next: 'SPEC_REVIEWING', role: planner, action: 'revise_spec', circuitBreaker: 'evaluator' };
  }
  for (const [bug, n] of Object.entries(counters.fix_per_bug || {})) {
    if (n >= thresholds.fix_per_bug) {
      return { next: 'TECH_LEAD_REVIEW', role: dev, action: 'reevaluate_implementation', circuitBreaker: 'fix', bug };
    }
  }

  // Backbone dispatch ---------------------------------------------------------
  if (TERMINAL.has(state)) {
    return { next: state, role: null, action: 'noop' };
  }

  switch (state) {
    case 'INIT':
      return { next: 'REQ_DRAFTED', role: null, action: 'await_requirements_md' };
    case 'REQ_DRAFTED':
      return { next: 'SPEC_DRAFTED', role: planner, action: 'draft_spec' };
    case 'SPEC_DRAFTED':
      return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
    case 'SPEC_REVIEWING':
      return { next: 'PARSE_SPEC_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'SPEC_NEEDS_REVISION':
      return { next: 'SPEC_DRAFTED', role: planner, action: 'revise_spec' };
    case HUMAN_GATE:
      if (humanGateApproved) return { next: 'SPEC_APPROVED', role: null, action: 'continue' };
      return { next: HUMAN_GATE, role: null, action: 'await_human_approval', stop: true };
    case 'SPEC_APPROVED':
      return { next: `SPRINT_${sprint.current || 1}_KICKOFF`, role: null, action: 'kickoff_sprint' };

    default:
      // Sprint states
      const m = state.match(/^SPRINT_(\d+)_(\w+)$/);
      if (m) {
        const N = parseInt(m[1], 10);
        const phase = m[2];
        switch (phase) {
          case 'KICKOFF':
            // Parallel: QA writes cases + Dev implements
            return { next: `SPRINT_${N}_DEV`, role: dev, action: 'implement', parallel: { role: qa, action: 'write_cases' } };
          case 'DEV':
            return { next: `SPRINT_${N}_REVIEW`, role: reviewer, action: 'review_code', sprint: N };
          case 'REVIEW':
            return { next: `SPRINT_${N}_PARSE_REVIEW`, role: null, action: 'parse_review_conclusion', sprint: N };
          case 'TEST':
            return { next: `SPRINT_${N}_PARSE_TEST`, role: null, action: 'parse_test_conclusion', sprint: N };
          case 'FIX':
            return { next: `SPRINT_${N}_REGRESSION`, role: qa, action: 'regression', sprint: N };
          case 'REGRESSION':
            return { next: `SPRINT_${N}_PARSE_REGRESSION`, role: null, action: 'parse_regression_conclusion', sprint: N };
          case 'EVAL':
            return { next: `SPRINT_${N}_PARSE_EVAL`, role: null, action: 'parse_eval_conclusion', sprint: N };
          case 'DONE':
            if (sprint.total && N >= sprint.total) {
              return { next: 'ALL_SPRINTS_DONE', role: null, action: 'continue' };
            }
            return { next: `SPRINT_${N + 1}_KICKOFF`, role: null, action: 'kickoff_sprint' };
          default:
            return { next: state, role: null, action: 'unknown_phase' };
        }
      }

      if (state === 'ALL_SPRINTS_DONE') {
        return { next: 'FINAL_EVAL', role: evaluator, action: 'final_acceptance' };
      }
      if (state === 'FINAL_EVAL') {
        return { next: 'PARSE_FINAL_EVAL', role: null, action: 'parse_final_conclusion' };
      }
      if (state === 'TECH_LEAD_REVIEW') {
        return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
      }

      return { next: state, role: null, action: 'unknown_state' };
  }
}

/**
 * fast 模式状态机：单 sprint，三角色合并。
 * 专为单接口/单模块小改动设计，比 full 少 ~50% 调用。
 *
 * 状态序列：
 *   INIT → REQ_DRAFTED → SPEC_DRAFTED → SPEC_REVIEWING
 *     → [SPEC_PENDING_HUMAN] → SPEC_APPROVED
 *     → BUILD → TEST → [FIX → REGRESSION]* → ACCEPT → COMPLETE
 *
 * 与 full 的关键差异：
 *   - 没有 SPRINT_<N>_* 命名（强制单 sprint）
 *   - TEST 一次完成 cases + run（合并 QA cases/run）
 *   - ACCEPT 一次完成代码评审 + 契约验收（合并 SA code + Evaluator）
 *   - 熔断阈值更严（preset thresholds_override）
 */
function nextStepFast({ state, counters, thresholds, enabledRoles, humanGateApproved }) {
  const has = (r) => enabledRoles.includes(r);
  // fast 模式三角色：fullstack / reviewer / verifier，缺一不可
  const fullstack = has('fullstack') ? 'fullstack' : null;
  const reviewer = has('reviewer') ? 'reviewer' : has('sa') ? 'sa' : null;
  const verifier = has('verifier') ? 'verifier' : has('qa') ? 'qa' : null;

  // Circuit breakers ----------------------------------------------------------
  if (counters.review_revision >= thresholds.review_revision) {
    return { next: 'SPEC_REVIEWING', role: fullstack, action: 'revise_spec', circuitBreaker: 'review' };
  }
  if (counters.evaluator_reject >= thresholds.evaluator_reject) {
    return { next: 'SPEC_REVIEWING', role: fullstack, action: 'revise_spec', circuitBreaker: 'evaluator' };
  }
  for (const [bug, n] of Object.entries(counters.fix_per_bug || {})) {
    if (n >= thresholds.fix_per_bug) {
      // fast 模式没有 TECH_LEAD_REVIEW 兜底岗，直接停下要人工
      return { next: 'HUMAN_INTERVENTION', role: null, action: 'await_human', circuitBreaker: 'fix', bug, stop: true };
    }
  }

  // Backbone dispatch ---------------------------------------------------------
  if (TERMINAL.has(state)) {
    return { next: state, role: null, action: 'noop' };
  }

  switch (state) {
    case 'INIT':
      return { next: 'REQ_DRAFTED', role: null, action: 'await_requirements_md' };
    case 'REQ_DRAFTED':
      return { next: 'SPEC_DRAFTED', role: fullstack, action: 'draft_spec' };
    case 'SPEC_DRAFTED':
      return { next: 'SPEC_REVIEWING', role: reviewer, action: 'review_spec' };
    case 'SPEC_REVIEWING':
      return { next: 'PARSE_SPEC_REVIEW', role: null, action: 'parse_review_conclusion' };
    case 'SPEC_NEEDS_REVISION':
      return { next: 'SPEC_DRAFTED', role: fullstack, action: 'revise_spec' };
    case HUMAN_GATE:
      if (humanGateApproved) return { next: 'SPEC_APPROVED', role: null, action: 'continue' };
      return { next: HUMAN_GATE, role: null, action: 'await_human_approval', stop: true };
    case 'SPEC_APPROVED':
      return { next: 'BUILD', role: fullstack, action: 'implement' };
    case 'BUILD':
      // 实现完成后由 verifier 一次产 cases + run + report
      return { next: 'TEST', role: verifier, action: 'verify_initial' };
    case 'TEST':
      return { next: 'PARSE_TEST', role: null, action: 'parse_test_conclusion' };
    case 'TEST_BLOCKED':
      return { next: 'FIX', role: fullstack, action: 'fix_bug' };
    case 'FIX':
      return { next: 'REGRESSION', role: verifier, action: 'verify_regression' };
    case 'REGRESSION':
      return { next: 'PARSE_REGRESSION', role: null, action: 'parse_regression_conclusion' };
    case 'TEST_PASSED':
      // initial 通过 或 regression 通过 → 进入合并 ACCEPT
      return { next: 'ACCEPT', role: reviewer, action: 'review_and_accept' };
    case 'ACCEPT':
      return { next: 'PARSE_ACCEPT', role: null, action: 'parse_accept_conclusion' };
    case 'ACCEPT_NEEDS_REVISION':
      // 代码评审 NEEDS_REVISION 或 契约验收 未通过 → 回 BUILD（fullstack 修，并 increment 对应计数）
      return { next: 'BUILD', role: fullstack, action: 'revise_implementation' };
    default:
      return { next: state, role: null, action: 'unknown_state' };
  }
}

export const STATES = {
  TERMINAL,
  HUMAN_GATE,
};

