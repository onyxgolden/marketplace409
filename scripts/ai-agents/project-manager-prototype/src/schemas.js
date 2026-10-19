// schemas.js — runtime validation. Rejects unknown control fields, missing
// required fields, wrong types, bad enums, duplicate IDs, nonfinite numbers.

const TASK_FIELDS = ['schema_version', 'task_id', 'operation', 'fixture_refs', 'options'];
const CONTEXT_FIELDS = ['clock', 'criteria_version', 'principal', 'grants', 'request_authority', 'fixtureStore'];
const OPTION_FIELDS = ['include_draft_summary'];

function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }
function isNonNegInt(v) { return isInt(v) && v >= 0; }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function unknownFields(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

export function checkTask(task) {
  const errors = [];
  if (!task || typeof task !== 'object' || Array.isArray(task)) return { ok: false, errors: ['task must be an object'] };
  const unk = unknownFields(task, TASK_FIELDS);
  if (unk.length) errors.push(`unknown task fields: ${unk.join(',')}`);
  if (task.schema_version !== '1') errors.push('schema_version must be "1"');
  if (typeof task.task_id !== 'string' || !task.task_id) errors.push('task_id must be a non-empty string');
  if (task.operation !== 'analyze') errors.push('operation must be "analyze"');
  if (!Array.isArray(task.fixture_refs)) errors.push('fixture_refs must be an array');
  else for (const r of task.fixture_refs) if (typeof r !== 'string') errors.push('fixture_refs entries must be strings');
  if (!task.options || typeof task.options !== 'object' || Array.isArray(task.options)) {
    errors.push('options must be an object');
  } else {
    const uo = unknownFields(task.options, OPTION_FIELDS);
    if (uo.length) errors.push(`unknown options fields: ${uo.join(',')}`);
    if ('include_draft_summary' in task.options && typeof task.options.include_draft_summary !== 'boolean') {
      errors.push('options.include_draft_summary must be boolean');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function checkContext(ctx) {
  const errors = [];
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return { ok: false, errors: ['context must be an object'] };
  const unk = unknownFields(ctx, CONTEXT_FIELDS);
  if (unk.length) errors.push(`unknown context fields: ${unk.join(',')}`);
  if (!ctx.clock || typeof ctx.clock !== 'object') errors.push('clock required');
  if (typeof ctx.request_authority !== 'string') errors.push('request_authority required');
  if (ctx.fixtureStore !== undefined && (typeof ctx.fixtureStore !== 'object' || ctx.fixtureStore === null)) {
    errors.push('fixtureStore must be an object');
  }
  return { ok: errors.length === 0, errors };
}

// ---- plan package schema (the domain document inside a fixture) ----

const PKG_FIELDS = ['plan_id', 'project_start_tick', 'tasks', 'edges', 'milestones', 'capacity_windows', 'header_claims', 'source_ref'];
const TASK_ROW_FIELDS = ['task_id', 'workstream_id', 'duration_ticks', 'declared_start_tick', 'release_tick', 'status', 'resource_demands', 'notes'];
const EDGE_FIELDS = ['edge_id', 'from_task', 'to_task', 'lag_ticks'];
const MILESTONE_FIELDS = ['milestone_id', 'required_tasks', 'claimed_tick'];
const WINDOW_FIELDS = ['window_id', 'resource_id', 'start_tick', 'end_tick', 'capacity'];
const DEMAND_FIELDS = ['resource_id', 'amount_num', 'amount_den'];
const HEADER_FIELDS = ['claimed_completion_pct', 'claimed_window_text'];
const TASK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'];

export function checkPlanPackage(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { ok: false, errors: ['package must be an object'] };
  const unk = unknownFields(pkg, PKG_FIELDS);
  if (unk.length) errors.push(`unknown package fields: ${unk.join(',')}`);
  if (typeof pkg.plan_id !== 'string' || !pkg.plan_id) errors.push('plan_id required');
  if (!isInt(pkg.project_start_tick)) errors.push('project_start_tick must be an integer');
  for (const [key, fields, label] of [
    ['tasks', TASK_ROW_FIELDS, 'task'],
    ['edges', EDGE_FIELDS, 'edge'],
    ['milestones', MILESTONE_FIELDS, 'milestone'],
    ['capacity_windows', WINDOW_FIELDS, 'capacity window'],
  ]) {
    if (!Array.isArray(pkg[key])) { errors.push(`${key} must be an array`); continue; }
    pkg[key].forEach((row, i) => {
      if (!row || typeof row !== 'object') { errors.push(`${label}[${i}] must be an object`); return; }
      const u = unknownFields(row, fields);
      if (u.length) errors.push(`${label}[${i}] unknown fields: ${u.join(',')}`);
    });
  }
  if (pkg.header_claims !== undefined) {
    if (typeof pkg.header_claims !== 'object' || pkg.header_claims === null || Array.isArray(pkg.header_claims)) {
      errors.push('header_claims must be an object');
    } else {
      const u = unknownFields(pkg.header_claims, HEADER_FIELDS);
      if (u.length) errors.push(`header_claims unknown fields: ${u.join(',')}`);
    }
  }
  // per-row value checks (structural; domain math lives in manager.js)
  (pkg.tasks || []).forEach((t, i) => {
    if (typeof t.task_id !== 'string' || !t.task_id) errors.push(`task[${i}].task_id required`);
    if (!isNonNegInt(t.duration_ticks)) errors.push(`task[${i}].duration_ticks must be a non-negative integer`);
    if (t.declared_start_tick !== null && t.declared_start_tick !== undefined && !isInt(t.declared_start_tick)) {
      errors.push(`task[${i}].declared_start_tick must be integer or null`);
    }
    if (t.release_tick !== undefined && t.release_tick !== null && !isInt(t.release_tick)) {
      errors.push(`task[${i}].release_tick must be integer or null`);
    }
    if (!TASK_STATUSES.includes(t.status)) errors.push(`task[${i}].status must be one of ${TASK_STATUSES.join('/')}`);
    if (t.resource_demands !== undefined) {
      if (!Array.isArray(t.resource_demands)) errors.push(`task[${i}].resource_demands must be an array`);
      else t.resource_demands.forEach((d, j) => {
        if (!d || typeof d !== 'object') { errors.push(`task[${i}].resource_demands[${j}] must be an object`); return; }
        const u = unknownFields(d, DEMAND_FIELDS);
        if (u.length) errors.push(`task[${i}].resource_demands[${j}] unknown fields: ${u.join(',')}`);
        if (typeof d.resource_id !== 'string' || !d.resource_id) errors.push(`task[${i}].resource_demands[${j}].resource_id required`);
        if (!isInt(d.amount_num) || !isInt(d.amount_den) || d.amount_den <= 0) {
          errors.push(`task[${i}].resource_demands[${j}] amount must be rational with positive denominator`);
        }
        if (d.amount_num < 0) errors.push(`task[${i}].resource_demands[${j}] amount_num must be >= 0`);
      });
    }
  });
  (pkg.edges || []).forEach((e, i) => {
    if (typeof e.edge_id !== 'string' || !e.edge_id) errors.push(`edge[${i}].edge_id required`);
    if (typeof e.from_task !== 'string' || typeof e.to_task !== 'string') errors.push(`edge[${i}] from_task/to_task required`);
    if (!isInt(e.lag_ticks)) errors.push(`edge[${i}].lag_ticks must be an integer`);
  });
  (pkg.milestones || []).forEach((m, i) => {
    if (typeof m.milestone_id !== 'string' || !m.milestone_id) errors.push(`milestone[${i}].milestone_id required`);
    if (!Array.isArray(m.required_tasks)) errors.push(`milestone[${i}].required_tasks must be an array`);
    if (m.claimed_tick !== null && m.claimed_tick !== undefined && !isInt(m.claimed_tick)) {
      errors.push(`milestone[${i}].claimed_tick must be integer or null`);
    }
  });
  (pkg.capacity_windows || []).forEach((w, i) => {
    if (typeof w.window_id !== 'string' || !w.window_id) errors.push(`capacity_windows[${i}].window_id required`);
    if (typeof w.resource_id !== 'string' || !w.resource_id) errors.push(`capacity_windows[${i}].resource_id required`);
    if (!isInt(w.start_tick) || !isInt(w.end_tick)) errors.push(`capacity_windows[${i}] start/end_tick must be integers`);
    if (w.end_tick < w.start_tick) errors.push(`capacity_windows[${i}] end_tick < start_tick`);
    if (!isFiniteNum(w.capacity) || w.capacity < 0) errors.push(`capacity_windows[${i}].capacity must be >= 0`);
  });
  return { ok: errors.length === 0, errors };
}
