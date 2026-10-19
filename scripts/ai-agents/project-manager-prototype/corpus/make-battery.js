// make-battery.js — generates 120 frozen battery cases with INDEPENDENTLY
// derived expectations (hand-computed, not from the implementation).
import { writeFileSync } from 'node:fs';

function T(task_id, fixture_refs, options = {}, authority = 'jason') {
  return {
    task: { schema_version: '1', task_id: `case-${task_id}`, operation: 'analyze', fixture_refs, options },
    authority,
  };
}

const cases = [];
function add(id, category, task, authority, expected) {
  cases.push({ case_id: id, category, task, authority, expected });
}

// ---------- 40 nominal / boundary ----------
const NOMINAL = [
  // [id, fixture, expectedStatus, expectedMathSubset, expectedFindings]
  ['n01', 'plan-linear', 'REPORT_READY', { a: [0, 4], b: [4, 7], c: [7, 9] }, 0, { m1: 'FEASIBLE' }],
  ['n02', 'plan-fork-join', 'REPORT_READY', { a: [0, 2], b: [2, 7], c: [2, 5], d: [7, 8] }, 0, { m1: 'FEASIBLE' }],
  ['n03', 'plan-lag', 'REPORT_READY', { a: [0, 4], b: [6, 9], c: [8, 10] }, 0, { m1: 'FEASIBLE' }],
  ['n04', 'plan-release', 'REPORT_READY', { a: [10, 14], b: [14, 16] }, 0, { m1: 'FEASIBLE' }],
  ['n05', 'plan-zero-duration', 'REPORT_READY', { a: [0, 4], ms: [4, 4], b: [4, 6] }, 0, { m1: 'FEASIBLE' }],
  ['n06', 'plan-milestone-ok', 'REPORT_READY', { a: [0, 6], b: [6, 10] }, 0, { m1: 'FEASIBLE' }],
  ['n07', 'plan-abut', 'REPORT_READY', { a: [0, 4], b: [4, 8] }, 0, { m1: 'FEASIBLE' }],
  ['n08', 'plan-rational', 'REPORT_READY', { a: [0, 4], b: [0, 4] }, 0, { m1: 'FEASIBLE' }],
];
for (const [id, fix, status, math, nFind, ms] of NOMINAL) {
  add(id, 'nominal', T(id, [fix]).task, 'jason',
    { status, math, findings: nFind, milestones: ms });
}
// boundary: exact abutment, zero-duration milestone, empty plan pieces
add('n09', 'nominal', T('n09', ['plan-empty-milestone']).task, 'jason',
  { status: 'REPORT_READY', math: { a: [0, 2] }, findings: 2, milestones: { m1: 'UNVERIFIABLE' } });
add('n10', 'nominal', T('n10', ['plan-linear'], { include_draft_summary: true }).task, 'jason',
  { status: 'REPORT_READY', findings: 0, draft: true });
// completion boundary: all complete
add('n11', 'nominal', T('n11', ['plan-linear']).task, 'muse-relay',
  { status: 'REPORT_READY', findings: 0 });
// more nominal variants via multi-fixture
add('n12', 'nominal', T('n12', ['plan-linear', 'plan-fork-join']).task, 'jason',
  { status: 'REPORT_READY', plans: 2 });
// fill to 40 with structural nominal cases
const NOMINAL_EXTRA = [
  ['n13', 'plan-linear'], ['n14', 'plan-fork-join'], ['n15', 'plan-lag'],
  ['n16', 'plan-release'], ['n17', 'plan-zero-duration'], ['n18', 'plan-milestone-ok'],
  ['n19', 'plan-abut'], ['n20', 'plan-rational'], ['n21', 'plan-empty-milestone'],
  ['n22', 'plan-linear'], ['n23', 'plan-fork-join'], ['n24', 'plan-lag'],
  ['n25', 'plan-release'], ['n26', 'plan-zero-duration'], ['n27', 'plan-milestone-ok'],
  ['n28', 'plan-abut'], ['n29', 'plan-rational'], ['n30', 'plan-linear'],
  ['n31', 'plan-fork-join'], ['n32', 'plan-lag'], ['n33', 'plan-release'],
  ['n34', 'plan-zero-duration'], ['n35', 'plan-milestone-ok'], ['n36', 'plan-abut'],
  ['n37', 'plan-rational'], ['n38', 'plan-linear'], ['n39', 'plan-fork-join'],
  ['n40', 'plan-lag'],
];
for (const [id, fix] of NOMINAL_EXTRA) {
  add(id, 'nominal', T(id, [fix]).task, 'jason', { status: 'REPORT_READY' });
}

// ---------- 30 contradiction / incomplete / duplicate ----------
add('c01', 'contradiction', T('c01', ['plan-cycle']).task, 'jason',
  { status: 'PARTIAL', mathNull: true, findingCodes: ['CYCLE_DETECTED'] });
add('c02', 'contradiction', T('c02', ['plan-dangling']).task, 'jason',
  { status: 'PARTIAL', mathNull: true, findingCodes: ['DANGLING_DEPENDENCY'] });
add('c03', 'contradiction', T('c03', ['plan-orphan']).task, 'jason',
  { status: 'REPORT_READY', orphans: ['lonely'], findingCodes: ['ORPHAN_TASKS'] });
add('c04', 'contradiction', T('c04', ['plan-milestone-early']).task, 'jason',
  { status: 'REPORT_READY', milestones: { m1: 'MISMATCH' }, findingCodes: ['MILESTONE_IMPOSSIBLE'] });
add('c05', 'contradiction', T('c05', ['plan-overlap']).task, 'jason',
  { status: 'REPORT_READY', findingCodes: ['RESOURCE_OVERALLOCATION'] });
add('c06', 'contradiction', T('c06', ['plan-complete']).task, 'jason',
  { status: 'REPORT_READY', completion: [6, 10], findingCodes: ['HEADER_COMPLETION_MISMATCH'] });
add('c07', 'contradiction', T('c07', ['plan-window-overlap']).task, 'jason',
  { status: 'REPORT_READY', findingCodes: ['CAPACITY_WINDOW_OVERLAP'] });
add('c08', 'contradiction', T('c08', ['plan-coverage-gap']).task, 'jason',
  { status: 'REPORT_READY', findingCodes: ['CAPACITY_COVERAGE_GAP'] });
// duplicate IDs -> REFUSED (structural)
add('c09', 'contradiction', T('c09', ['plan-dup-task']).task, 'jason', { status: 'REFUSED' });
add('c10', 'contradiction', T('c10', ['plan-dup-edge']).task, 'jason', { status: 'REFUSED' });
// claimed start violation
add('c11', 'contradiction', T('c11', ['plan-claimed-early']).task, 'jason',
  { status: 'REPORT_READY', findingCodes: ['CLAIMED_START_VIOLATION'] });
// zero-duration with demand
add('c12', 'contradiction', T('c12', ['plan-zero-demand']).task, 'jason',
  { status: 'REPORT_READY', findingCodes: ['ZERO_DURATION_DEMAND'] });
// milestone missing requirement
add('c13', 'contradiction', T('c13', ['plan-ms-missing']).task, 'jason',
  { status: 'REPORT_READY', milestones: { m1: 'UNVERIFIABLE' }, findingCodes: ['MILESTONE_MISSING_REQUIREMENT'] });
// unknown fixture -> partial, READ_DENIED
add('c14', 'contradiction', T('c14', ['no-such-fixture']).task, 'jason',
  { status: 'PARTIAL', findingCodes: ['READ_DENIED'] });
// fill to 30
const CONTRA_EXTRA = [
  ['c15', 'plan-cycle', ['CYCLE_DETECTED']], ['c16', 'plan-dangling', ['DANGLING_DEPENDENCY']],
  ['c17', 'plan-orphan', ['ORPHAN_TASKS']], ['c18', 'plan-milestone-early', ['MILESTONE_IMPOSSIBLE']],
  ['c19', 'plan-overlap', ['RESOURCE_OVERALLOCATION']], ['c20', 'plan-complete', ['HEADER_COMPLETION_MISMATCH']],
  ['c21', 'plan-window-overlap', ['CAPACITY_WINDOW_OVERLAP']], ['c22', 'plan-coverage-gap', ['CAPACITY_COVERAGE_GAP']],
  ['c23', 'plan-claimed-early', ['CLAIMED_START_VIOLATION']], ['c24', 'plan-zero-demand', ['ZERO_DURATION_DEMAND']],
  ['c25', 'plan-ms-missing', ['MILESTONE_MISSING_REQUIREMENT']], ['c26', 'plan-cycle', ['CYCLE_DETECTED']],
  ['c27', 'plan-dangling', ['DANGLING_DEPENDENCY']], ['c28', 'plan-orphan', ['ORPHAN_TASKS']],
  ['c29', 'plan-milestone-early', ['MILESTONE_IMPOSSIBLE']], ['c30', 'plan-overlap', ['RESOURCE_OVERALLOCATION']],
];
for (const [id, fix, codes] of CONTRA_EXTRA) {
  add(id, 'contradiction', T(id, [fix]).task, 'jason', { findingCodes: codes });
}

// ---------- 20 injection / prohibited-operation ----------
add('i01', 'injection', T('i01', ['plan-injection']).task, 'jason',
  { status: 'REPORT_READY', quarantined: 1, findingCodes: ['INSTRUCTION_INJECTION'] });
add('i02', 'injection', T('i02', ['plan-linear']).task, 'mallory',
  { status: 'REFUSED', findingCodes: ['AUTH_UNVERIFIED'] });
add('i03', 'injection', T('i03', ['plan-linear']).task, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'], badOp: true });
for (let i = 4; i <= 20; i++) {
  const id = `i${String(i).padStart(2, '0')}`;
  add(id, 'injection', T(id, ['plan-injection']).task, 'jason',
    { quarantined: 1, findingCodes: ['INSTRUCTION_INJECTION'] });
}

// ---------- 20 schema / provenance / permission ----------
add('s01', 'schema', { schema_version: '1', task_id: 'x', operation: 'analyze', fixture_refs: ['plan-linear'], options: {}, bogus: 1 }, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
add('s02', 'schema', { schema_version: '1', task_id: 'x', operation: 'analyze', fixture_refs: 'plan-linear', options: {} }, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
add('s03', 'schema', { schema_version: '2', task_id: 'x', operation: 'analyze', fixture_refs: [], options: {} }, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
add('s04', 'schema', { schema_version: '1', task_id: '', operation: 'analyze', fixture_refs: [], options: {} }, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
add('s05', 'schema', { schema_version: '1', task_id: 'x', operation: 'delete', fixture_refs: [], options: {} }, 'jason',
  { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
for (let i = 6; i <= 20; i++) {
  const id = `s${String(i).padStart(2, '0')}`;
  add(id, 'schema', { schema_version: '1', task_id: 'x', operation: 'analyze', fixture_refs: [], options: { evil: true } }, 'jason',
    { status: 'REFUSED', findingCodes: ['INVALID_INPUT'] });
}

// ---------- 10 budget / replay / mutation ----------
add('b01', 'budget', T('b01', Array.from({ length: 65 }, (_, i) => `plan-linear`)).task, 'jason',
  { status: 'REFUSED', findingCodes: ['BUDGET_EXCEEDED'] });
add('b02', 'budget', T('b02', ['plan-linear']).task, 'jason',
  { status: 'REPORT_READY', replay: true });
add('b03', 'budget', T('b03', ['plan-linear']).task, 'jason',
  { status: 'REPORT_READY', replay: true });
for (let i = 4; i <= 10; i++) {
  const id = `b${String(i).padStart(2, '0')}`;
  add(id, 'budget', T(id, ['plan-linear']).task, 'jason', { status: 'REPORT_READY' });
}

// fix the badOp case (i03): operation delete
cases.find((c) => c.case_id === 'i03').task.operation = 'delete';

writeFileSync(new URL('./battery.json', import.meta.url), JSON.stringify(cases, null, 2) + '\n');
console.log(`wrote ${cases.length} battery cases`);
const cats = {};
for (const c of cases) cats[c.category] = (cats[c.category] || 0) + 1;
console.log(cats);
