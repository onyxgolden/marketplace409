// schemas.js — runtime validation. Budget-aware, descriptor-safe.
// Each CANDIDATE object (task, context, principal, grant, package, row,
// edge, milestone, window, demand) is charged ONCE before its fields are
// read. Field reads within a charged object are free but descriptor-safe.
// Getters/setters are refused. Rejects unknown fields, missing required
// fields, wrong types, bad enums, duplicate IDs, unsafe numbers, reserved keys.

const TASK_FIELDS = ['schema_version', 'task_id', 'operation', 'fixture_refs', 'options'];
const CONTEXT_FIELDS = ['clock', 'criteria_version', 'principal', 'grants', 'request_authority', 'relay', 'fixtureStore', 'population'];
const POPULATION_FIELDS = ['expected_tasks', 'scope'];
const OPTION_FIELDS = ['include_draft_summary'];
const PRINCIPAL_FIELDS = ['principal_id', 'kind'];
const GRANT_FIELDS = ['grant_id', 'principal_id', 'action', 'resource'];
const GRANT_RESOURCE_FIELDS = ['fixture_id'];
const RELAY_FIELDS = ['relay_id', 'delegate_principal_id', 'valid', 'scope'];

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(k) {
  return typeof k === 'string' && !RESERVED_KEYS.has(k);
}

function safeGet(obj, key, label) {
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc) return { value: undefined, present: false };
  if (typeof desc.get === 'function' || typeof desc.set === 'function') {
    const e = new Error(`ACCESSOR_REJECTED: ${label}.${key} is a getter/setter`);
    e.code = 'ACCESSOR_REJECTED';
    throw e;
  }
  return { value: desc.value, present: true };
}

function isInt(v) { return typeof v === 'number' && Number.isInteger(v); }
function isSafeInt(v) { return isInt(v) && Number.isSafeInteger(v); }
function isNonNegSafeInt(v) { return isSafeInt(v) && v >= 0; }
function isFiniteNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function unknownFields(obj, allowed) {
  const out = [];
  for (const k of Object.keys(obj)) {
    if (!isSafeKey(k)) out.push(`reserved:${k}`);
    else if (!allowed.includes(k)) out.push(k);
  }
  return out;
}

function err(errors, msg) { errors.push(msg); }
function charge(budget) { if (budget) budget.chargeObject(); }

export function checkTask(task, budget) {
  const errors = [];
  try {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return { ok: false, errors: ['task must be an object'] };
    charge(budget); // task candidate
    const tidDesc = Object.getOwnPropertyDescriptor(task, 'task_id');
    if (tidDesc && typeof tidDesc.value === 'string' && tidDesc.value.length > 1024) {
      return { ok: false, errors: ['task_id exceeds 1024 chars'], oversizedId: true };
    }
    const unk = unknownFields(task, TASK_FIELDS);
    if (unk.length) err(errors, `unknown task fields: ${unk.join(',')}`);
    if (safeGet(task, 'schema_version', 'task').value !== '1') err(errors, 'schema_version must be "1"');
    const tid = safeGet(task, 'task_id', 'task').value;
    if (typeof tid !== 'string' || !tid) err(errors, 'task_id must be a non-empty string');
    const op = safeGet(task, 'operation', 'task').value;
    if (typeof op !== 'string' || !op) err(errors, 'operation must be a non-empty string');
    // Note: unsupported operations are named UNSUPPORTED_TASK by the caller (index.js).
    const refs = safeGet(task, 'fixture_refs', 'task').value;
    if (!Array.isArray(refs)) err(errors, 'fixture_refs must be an array');
    else {
      for (let i = 0; i < refs.length; i++) {
        charge(budget); // each ref candidate
        const r = safeGet(refs, String(i), 'task.fixture_refs').value;
        if (typeof r !== 'string') err(errors, `fixture_refs[${i}] must be a string`);
      }
    }
    const opts = safeGet(task, 'options', 'task').value;
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
      err(errors, 'options must be an object');
    } else {
      charge(budget); // options candidate
      const uo = unknownFields(opts, OPTION_FIELDS);
      if (uo.length) err(errors, `unknown options fields: ${uo.join(',')}`);
      const ids = safeGet(opts, 'include_draft_summary', 'task.options').value;
      if (ids !== undefined && typeof ids !== 'boolean') err(errors, 'options.include_draft_summary must be boolean');
    }
  } catch (e) {
    if (e.code === 'ACCESSOR_REJECTED' || e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT') throw e;
    err(errors, `task validation error: ${e.message}`);
  }
  return { ok: errors.length === 0, errors };
}

export function checkContext(ctx, budget) {
  const errors = [];
  try {
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return { ok: false, errors: ['context must be an object'] };
    charge(budget); // context candidate
    const unk = unknownFields(ctx, CONTEXT_FIELDS);
    if (unk.length) err(errors, `unknown context fields: ${unk.join(',')}`);
    const clock = safeGet(ctx, 'clock', 'context').value;
    if (!clock || typeof clock !== 'object') err(errors, 'clock required');
    if (safeGet(ctx, 'criteria_version', 'context').value !== '1') err(errors, 'criteria_version must be "1"');

    const principal = safeGet(ctx, 'principal', 'context').value;
    if (!principal || typeof principal !== 'object' || Array.isArray(principal)) {
      err(errors, 'principal must be an object');
    } else {
      charge(budget); // principal candidate
      const up = unknownFields(principal, PRINCIPAL_FIELDS);
      if (up.length) err(errors, `unknown principal fields: ${up.join(',')}`);
      const pid = safeGet(principal, 'principal_id', 'context.principal').value;
      if (typeof pid !== 'string' || !pid) err(errors, 'principal.principal_id required');
      const kind = safeGet(principal, 'kind', 'context.principal').value;
      if (kind !== 'human' && kind !== 'relay') err(errors, 'principal.kind must be human or relay');
    }

    const grants = safeGet(ctx, 'grants', 'context').value;
    if (!Array.isArray(grants)) {
      err(errors, 'grants must be an array');
    } else {
      grants.forEach((g, i) => {
        charge(budget); // each grant candidate
        if (!g || typeof g !== 'object' || Array.isArray(g)) { err(errors, `grants[${i}] must be an object`); return; }
        const ug = unknownFields(g, GRANT_FIELDS);
        if (ug.length) err(errors, `grants[${i}] unknown fields: ${ug.join(',')}`);
        const gid = safeGet(g, 'grant_id', `grants[${i}]`).value;
        if (typeof gid !== 'string' || !gid) err(errors, `grants[${i}].grant_id required`);
        const gpid = safeGet(g, 'principal_id', `grants[${i}]`).value;
        if (typeof gpid !== 'string' || !gpid) err(errors, `grants[${i}].principal_id required`);
        const action = safeGet(g, 'action', `grants[${i}]`).value;
        if (action !== 'read') err(errors, `grants[${i}].action must be "read"`);
        const res = safeGet(g, 'resource', `grants[${i}]`).value;
        if (!res || typeof res !== 'object' || Array.isArray(res)) {
          err(errors, `grants[${i}].resource must be an object`);
        } else {
          charge(budget); // grant resource candidate
          const ur = unknownFields(res, GRANT_RESOURCE_FIELDS);
          if (ur.length) err(errors, `grants[${i}].resource unknown fields: ${ur.join(',')}`);
          const fid = safeGet(res, 'fixture_id', `grants[${i}].resource`).value;
          if (typeof fid !== 'string' || !fid) err(errors, `grants[${i}].resource.fixture_id required`);
        }
      });
    }

    const ra = safeGet(ctx, 'request_authority', 'context').value;
    if (typeof ra !== 'string' || !ra) err(errors, 'request_authority required');

    const relay = safeGet(ctx, 'relay', 'context').value;
    if (relay !== undefined && relay !== null) {
      if (typeof relay !== 'object' || Array.isArray(relay)) {
        err(errors, 'relay must be an object or null');
      } else {
        charge(budget); // relay candidate
        const ur = unknownFields(relay, RELAY_FIELDS);
        if (ur.length) err(errors, `unknown relay fields: ${ur.join(',')}`);
      }
    }

    const store = safeGet(ctx, 'fixtureStore', 'context').value;
    if (store !== undefined && (typeof store !== 'object' || store === null || Array.isArray(store))) {
      err(errors, 'fixtureStore must be an object');
    }

    // PM651-006: host-established population coverage (optional). If present,
    // it must declare the expected task count; completion.verified requires
    // the declaration to match the admitted population. Absent/unknown
    // coverage never yields a verified plan-wide percentage.
    const pop = safeGet(ctx, 'population', 'context').value;
    if (pop !== undefined && pop !== null) {
      if (typeof pop !== 'object' || Array.isArray(pop)) {
        err(errors, 'population must be an object');
      } else {
        charge(budget); // population candidate
        const up = unknownFields(pop, POPULATION_FIELDS);
        if (up.length) err(errors, `unknown population fields: ${up.join(',')}`);
        const et = safeGet(pop, 'expected_tasks', 'context.population').value;
        if (!isNonNegSafeInt(et)) err(errors, 'population.expected_tasks must be a non-negative safe integer');
        const scope = safeGet(pop, 'scope', 'context.population').value;
        if (scope !== undefined && scope !== null && (typeof scope !== 'string' || !scope)) {
          err(errors, 'population.scope must be a non-empty string if present');
        }
      }
    }
  } catch (e) {
    if (e.code === 'ACCESSOR_REJECTED' || e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT') throw e;
    err(errors, `context validation error: ${e.message}`);
  }
  return { ok: errors.length === 0, errors };
}

const PKG_FIELDS = ['plan_id', 'project_start_tick', 'tasks', 'edges', 'milestones', 'capacity_windows', 'header_claims', 'source_ref'];
const TASK_ROW_FIELDS = ['task_id', 'workstream_id', 'duration_ticks', 'declared_start_tick', 'release_tick', 'status', 'resource_demands', 'notes'];
const EDGE_FIELDS = ['edge_id', 'from_task', 'to_task', 'lag_ticks'];
const MILESTONE_FIELDS = ['milestone_id', 'required_tasks', 'claimed_tick'];
const WINDOW_FIELDS = ['window_id', 'resource_id', 'start_tick', 'end_tick', 'capacity'];
const DEMAND_FIELDS = ['resource_id', 'amount_num', 'amount_den'];
const HEADER_FIELDS = ['claimed_completion_pct', 'claimed_window_text'];
const TASK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'];

export function checkPlanPackage(pkg, budget) {
  const errors = [];
  const fail = (msg) => { err(errors, msg); return { ok: false, errors }; };
  try {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return fail('package must be an object');
    charge(budget); // package candidate
    const unk = unknownFields(pkg, PKG_FIELDS);
    if (unk.length) return fail(`unknown package fields: ${unk.join(',')}`);
    const planId = safeGet(pkg, 'plan_id', 'pkg').value;
    if (typeof planId !== 'string' || !planId || !isSafeKey(planId)) return fail('plan_id required');
    if (!isSafeInt(safeGet(pkg, 'project_start_tick', 'pkg').value)) return fail('project_start_tick must be a safe integer');

    const seen = { task: new Set(), edge: new Set(), milestone: new Set(), window: new Set() };
    for (const [key, fields, label, setKey] of [
      ['tasks', TASK_ROW_FIELDS, 'task', 'task'],
      ['edges', EDGE_FIELDS, 'edge', 'edge'],
      ['milestones', MILESTONE_FIELDS, 'milestone', 'milestone'],
      ['capacity_windows', WINDOW_FIELDS, 'capacity window', 'window'],
    ]) {
      const arr = safeGet(pkg, key, 'pkg').value;
      if (!Array.isArray(arr)) return fail(`${key} must be an array`);
      for (let i = 0; i < arr.length; i++) {
        charge(budget); // each row candidate
        const row = safeGet(arr, String(i), `pkg.${key}`).value;
        if (!row || typeof row !== 'object' || Array.isArray(row)) return fail(`${label}[${i}] must be an object`);
        const u = unknownFields(row, fields);
        if (u.length) return fail(`${label}[${i}] unknown fields: ${u.join(',')}`);
        const idKey = key === 'tasks' ? 'task_id' : key === 'edges' ? 'edge_id' : key === 'milestones' ? 'milestone_id' : 'window_id';
        const id = safeGet(row, idKey, `${label}[${i}]`).value;
        if (typeof id === 'string' && id) {
          if (seen[setKey].has(id)) return fail(`duplicate ${idKey}: ${id}`);
          seen[setKey].add(id);
        }
      }
    }

    const hc = safeGet(pkg, 'header_claims', 'pkg').value;
    if (hc !== undefined && hc !== null) {
      if (typeof hc !== 'object' || Array.isArray(hc)) return fail('header_claims must be an object');
      charge(budget);
      const u = unknownFields(hc, HEADER_FIELDS);
      if (u.length) return fail(`header_claims unknown fields: ${u.join(',')}`);
      const ccp = safeGet(hc, 'claimed_completion_pct', 'pkg.header_claims').value;
      // PM651-007: must be a finite number in [0,100]. Raw JSON 1e999 parses
      // to Infinity; serialization would turn it into null. Refuse structurally.
      if (ccp !== undefined && ccp !== null) {
        if (typeof ccp !== 'number' || !Number.isFinite(ccp)) {
          return fail('header_claims.claimed_completion_pct must be a finite number');
        }
        if (ccp < 0 || ccp > 100) {
          return fail('header_claims.claimed_completion_pct must be in [0,100]');
        }
      }
    }

    const tasks = safeGet(pkg, 'tasks', 'pkg').value;
    for (let i = 0; i < tasks.length; i++) {
      const t = safeGet(tasks, String(i), 'pkg.tasks').value;
      const tid = safeGet(t, 'task_id', `task[${i}]`).value;
      if (typeof tid !== 'string' || !tid || !isSafeKey(tid)) return fail(`task[${i}].task_id required`);
      if (!isNonNegSafeInt(safeGet(t, 'duration_ticks', `task[${i}]`).value)) return fail(`task[${i}].duration_ticks must be a non-negative safe integer`);
      const dst = safeGet(t, 'declared_start_tick', `task[${i}]`).value;
      if (dst !== null && dst !== undefined && !isSafeInt(dst)) return fail(`task[${i}].declared_start_tick must be safe integer or null`);
      const rt = safeGet(t, 'release_tick', `task[${i}]`).value;
      if (rt !== undefined && rt !== null && !isSafeInt(rt)) return fail(`task[${i}].release_tick must be safe integer or null`);
      if (!TASK_STATUSES.includes(safeGet(t, 'status', `task[${i}]`).value)) return fail(`task[${i}].status invalid`);
      // PM651-007: workstream_id is a required field per the brief.
      const wsid = safeGet(t, 'workstream_id', `task[${i}]`).value;
      if (typeof wsid !== 'string' || !wsid || !isSafeKey(wsid)) return fail(`task[${i}].workstream_id is required`);
      const notes = safeGet(t, 'notes', `task[${i}]`).value;
      if (notes !== undefined && notes !== null && typeof notes !== 'string') return fail(`task[${i}].notes must be a string`);
      const demands = safeGet(t, 'resource_demands', `task[${i}]`).value;
      if (demands !== undefined && demands !== null) {
        if (!Array.isArray(demands)) return fail(`task[${i}].resource_demands must be an array`);
        for (let j = 0; j < demands.length; j++) {
          charge(budget); // each demand candidate
          const d = safeGet(demands, String(j), `task[${i}].demands`).value;
          if (!d || typeof d !== 'object' || Array.isArray(d)) return fail(`task[${i}].resource_demands[${j}] must be an object`);
          const u = unknownFields(d, DEMAND_FIELDS);
          if (u.length) return fail(`task[${i}].resource_demands[${j}] unknown fields: ${u.join(',')}`);
          const rid = safeGet(d, 'resource_id', `demand`).value;
          if (typeof rid !== 'string' || !rid || !isSafeKey(rid)) return fail(`task[${i}].resource_demands[${j}].resource_id required`);
          const anum = safeGet(d, 'amount_num', `demand`).value;
          const aden = safeGet(d, 'amount_den', `demand`).value;
          if (!isSafeInt(anum) || !isSafeInt(aden) || aden <= 0) return fail(`task[${i}].resource_demands[${j}] amount must be safe rational with positive denominator`);
          if (anum < 0) return fail(`task[${i}].resource_demands[${j}] amount_num must be >= 0`);
        }
      }
    }
    const edges = safeGet(pkg, 'edges', 'pkg').value;
    for (let i = 0; i < edges.length; i++) {
      const e = safeGet(edges, String(i), 'pkg.edges').value;
      const eid = safeGet(e, 'edge_id', `edge[${i}]`).value;
      if (typeof eid !== 'string' || !eid || !isSafeKey(eid)) return fail(`edge[${i}].edge_id required`);
      const ft = safeGet(e, 'from_task', `edge[${i}]`).value;
      const tt = safeGet(e, 'to_task', `edge[${i}]`).value;
      if (typeof ft !== 'string' || typeof tt !== 'string' || !isSafeKey(ft) || !isSafeKey(tt)) return fail(`edge[${i}] from_task/to_task required`);
      if (!isSafeInt(safeGet(e, 'lag_ticks', `edge[${i}]`).value)) return fail(`edge[${i}].lag_ticks must be a safe integer`);
    }
    const milestones = safeGet(pkg, 'milestones', 'pkg').value;
    for (let i = 0; i < milestones.length; i++) {
      const m = safeGet(milestones, String(i), 'pkg.milestones').value;
      const mid = safeGet(m, 'milestone_id', `milestone[${i}]`).value;
      if (typeof mid !== 'string' || !mid || !isSafeKey(mid)) return fail(`milestone[${i}].milestone_id required`);
      const req = safeGet(m, 'required_tasks', `milestone[${i}]`).value;
      if (!Array.isArray(req)) return fail(`milestone[${i}].required_tasks must be an array`);
      for (let j = 0; j < req.length; j++) {
        const rt = safeGet(req, String(j), `milestone[${i}].req`).value;
        if (typeof rt !== 'string' || !isSafeKey(rt)) return fail(`milestone[${i}].required_tasks[${j}] must be a string`);
      }
      const ct = safeGet(m, 'claimed_tick', `milestone[${i}]`).value;
      if (ct !== null && ct !== undefined && !isSafeInt(ct)) return fail(`milestone[${i}].claimed_tick must be safe integer or null`);
    }
    const windows = safeGet(pkg, 'capacity_windows', 'pkg').value;
    for (let i = 0; i < windows.length; i++) {
      const w = safeGet(windows, String(i), 'pkg.windows').value;
      const wid = safeGet(w, 'window_id', `window[${i}]`).value;
      if (typeof wid !== 'string' || !wid || !isSafeKey(wid)) return fail(`capacity_windows[${i}].window_id required`);
      const rid = safeGet(w, 'resource_id', `window[${i}]`).value;
      if (typeof rid !== 'string' || !rid || !isSafeKey(rid)) return fail(`capacity_windows[${i}].resource_id required`);
      const st = safeGet(w, 'start_tick', `window[${i}]`).value;
      const et = safeGet(w, 'end_tick', `window[${i}]`).value;
      if (!isSafeInt(st) || !isSafeInt(et)) return fail(`capacity_windows[${i}] start/end_tick must be safe integers`);
      if (et < st) return fail(`capacity_windows[${i}] end_tick < start_tick`);
      const cap = safeGet(w, 'capacity', `window[${i}]`).value;
      if (typeof cap === 'number') {
        if (!isFiniteNum(cap) || cap < 0 || !isSafeInt(cap)) return fail(`capacity_windows[${i}].capacity must be a safe non-negative integer`);
      } else if (cap && typeof cap === 'object') {
        // PM651-007: nested rational capacity is a closed schema; unknown
        // control fields are refused, and the object is charged.
        charge(budget);
        const u = unknownFields(cap, ['num', 'den']);
        if (u.length) return fail(`capacity_windows[${i}].capacity unknown fields: ${u.join(',')}`);
        const cn = safeGet(cap, 'num', `window[${i}].cap`).value;
        const cd = safeGet(cap, 'den', `window[${i}].cap`).value;
        if (!isSafeInt(cn) || !isSafeInt(cd) || cd <= 0 || cn < 0) return fail(`capacity_windows[${i}].capacity rational invalid`);
      } else return fail(`capacity_windows[${i}].capacity must be a number or rational`);
    }
  } catch (e) {
    if (e.code === 'ACCESSOR_REJECTED' || e.code === 'BUDGET_EXCEEDED' || e.code === 'INPUT_LIMIT') throw e;
    return { ok: false, errors: [`package validation error: ${e.message}`] };
  }
  return { ok: errors.length === 0, errors };
}

export { isSafeKey, safeGet, RESERVED_KEYS };
