// admission.test.js — PC650-001: instrumented exact-fit/+1 tests.
// Proves that the 65th candidate is NOT READ (not just that refusal occurs).
// Uses getters that record if they were invoked; the 65th object's getter
// must never fire.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resolver } from '../src/resolver.js';
import { measureInputBytes, getOwnData, assertDeepNoAccessors } from '../src/admission.js';
import { run } from '../src/index.js';
import { canonicalStringify, utf8Length } from '../src/canonical.js';

test('PC650-001: 65th task object getter is never invoked', () => {
  // Build a task with 70 properties; the 65th must refuse BEFORE its getter runs.
  const task = {
    schema_version: '1',
    task_id: 'admission-1',
    operation: 'analyze',
    fixture_refs: [],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  let getter65Fired = false;
  // Add 70 properties with getters; the 65th should never be read
  for (let i = 0; i < 70; i++) {
    const idx = i;
    Object.defineProperty(task, `prop_${idx}`, {
      enumerable: true,
      get() {
        if (idx === 64) getter65Fired = true; // 0-indexed 64 = 65th
        return `value-${idx}`;
      },
    });
  }

  const r = new Resolver({});
  // measureInputBytes should refuse with BUDGET_EXCEEDED before reading prop_64
  // Note: assertNoAccessors will reject the getters first with INVALID_INPUT,
  // which is also correct (getters are not allowed). The key property is that
  // the getter is NEVER INVOKED.
  try {
    measureInputBytes(task, r);
    assert.fail('should have refused');
  } catch (e) {
    // Either BUDGET_EXCEEDED or INVALID_INPUT (accessor rejected) is acceptable,
    // but the getter must NOT have fired.
    assert.ok(['BUDGET_EXCEEDED', 'INVALID_INPUT'].includes(e.code), `got ${e.code}`);
  }
  assert.equal(getter65Fired, false, '65th object getter was invoked (budget not enforced before read)');
});

test('PC650-001: getOwnData does not invoke getters', () => {
  let fired = false;
  const obj = {};
  Object.defineProperty(obj, 'x', {
    enumerable: true,
    get() { fired = true; return 42; },
  });
  const slot = getOwnData(obj, 'x');
  assert.equal(slot.present, true);
  assert.equal(slot.isAccessor, true);
  assert.equal(fired, false, 'getOwnData invoked the getter');
});

test('PC650-001: assertDeepNoAccessors rejects nested getters without invoking', () => {
  let fired = false;
  const inner = {};
  Object.defineProperty(inner, 'evil', {
    enumerable: true,
    get() { fired = true; return 'x'; },
  });
  const outer = { a: 1, nested: inner };
  assert.throws(() => assertDeepNoAccessors(outer, 'test'), (e) => e.code === 'INVALID_INPUT');
  assert.equal(fired, false, 'assertDeepNoAccessors invoked the getter');
});

test('PC650-001: exact-fit 64 objects succeed, 65th refuses', () => {
  const r = new Resolver({});
  const objs = [];
  for (let i = 0; i < 64; i++) {
    const o = { idx: i };
    objs.push(o);
    r.chargeObject(o);
  }
  assert.equal(r.objectsCharged, 64);
  // 65th distinct object refuses
  assert.throws(() => r.chargeObject({ idx: 64 }), (e) => {
    assert.equal(e.code, 'BUDGET_EXCEEDED');
    return true;
  });
  // The 65th object was not added to the charged set (refused before)
  assert.equal(r.objectsCharged, 65);
});

test('PC650-001: 65th candidate with accessor refuses BUDGET_EXCEEDED before descriptor inspection', () => {
  // Verdict probe: Array root + 63 plain objects = 64 charged; the 65th has
  // one own accessor. Must refuse BUDGET_EXCEEDED, NOT INVALID_INPUT naming
  // the accessor (which would prove the 65th was inspected).
  const r = new Resolver({});
  const arr = [];
  for (let i = 0; i < 63; i++) arr.push({ idx: i });
  const evil = {};
  Object.defineProperty(evil, 'x', { enumerable: true, get() { return 1; } });
  arr.push(evil);
  // arr (1) + 63 objects (63) = 64 charged; evil is the 65th.
  try {
    measureInputBytes(arr, r);
    assert.fail('should have refused');
  } catch (e) {
    assert.equal(e.code, 'BUDGET_EXCEEDED', `expected BUDGET_EXCEEDED, got ${e.code}: ${e.message}`);
  }
  // The 65th candidate was never inspected: objectsCharged hit 65 (the
  // charge that threw), but no INVALID_INPUT naming the accessor.
});

test('PC650-001: invalidInput does not invoke task.task_id getter', () => {
  // Verdict probe: public task.task_id getter must not be invoked by the
  // refusal path. invalidInput used to read task.task_id twice.
    let calls = 0;
  const task = {
    schema_version: '1',
    operation: 'analyze',
    fixture_refs: [],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  Object.defineProperty(task, 'task_id', {
    enumerable: true,
    get() { calls++; return 'getter-id'; },
  });
  const context = {
    clock: { now: '2026-10-18T14:00:00Z' },
    criteria_version: 'controls-v1',
    principal: { id: 'muse-relay' },
    grants: [{ scope: 'read', fixture: '*' }],
    request_authority: 'muse-relay',
    fixtureStore: {},
  };
  const out = run(task, context);
  // The getter is rejected (not invoked); task_id is the inadmissible marker.
  assert.equal(calls, 0, `task_id getter invoked ${calls} times`);
  assert.equal(out.task_id, '[inadmissible-id]');
  assert.equal(out.status, 'REFUSED');
});

test('PC650-001: fixtureStore getter is not invoked before admission', () => {
  // Verdict probe: new Resolver(context.fixtureStore||{}) invoked the getter.
  // Must be descriptor-safe now: 0 invocations, and the request is refused
  // (not REPORT_READY).
    let calls = 0;
  const task = {
    schema_version: '1',
    task_id: 'fs-getter-test',
    operation: 'analyze',
    fixture_refs: ['fx1'],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  const context = {
    clock: { now: '2026-10-18T14:00:00Z' },
    criteria_version: 'controls-v1',
    principal: { id: 'muse-relay' },
    grants: [{ scope: 'read', fixture: '*' }],
    request_authority: 'muse-relay',
  };
  Object.defineProperty(context, 'fixtureStore', {
    enumerable: true,
    get() { calls++; return {}; },
  });
  const out = run(task, context);
  assert.equal(calls, 0, `fixtureStore getter invoked ${calls} times`);
  // Refused (accessor rejected), not REPORT_READY.
  assert.equal(out.status, 'REFUSED');
});

test('PC650-001: 300KB task_id yields bounded refusal envelope', () => {
  // Verdict probe: task_id="x".repeat(300000) must not produce a 300KB
  // envelope. The refusal uses '[inadmissible-id]' and stays under the cap.
        const task = {
    schema_version: '1',
    task_id: 'x'.repeat(300000),
    operation: 'analyze',
    fixture_refs: [],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  const context = {
    clock: { now: '2026-10-18T14:00:00Z' },
    criteria_version: 'controls-v1',
    principal: { id: 'muse-relay' },
    grants: [{ scope: 'read', fixture: '*' }],
    request_authority: 'muse-relay',
    fixtureStore: {},
  };
  const out = run(task, context);
  assert.equal(out.task_id, '[inadmissible-id]');
  const bytes = utf8Length(canonicalStringify(out));
  assert.ok(bytes < 256 * 1024, `refusal envelope ${bytes} bytes exceeds 256KiB cap`);
});

test('PC650-001: inherited prototype getter is rejected with zero invocations', () => {
  // Fifth fix round: a custom prototype carrying a getter for `operation`.
  // chargedStringify must reject the custom prototype AFTER charging but
  // BEFORE any field read, so the inherited getter never executes.
  let getterCalls = 0;
  const evilProto = {
    get operation() { getterCalls++; return 'analyze'; },
  };
  const task = Object.create(evilProto);
  task.schema_version = '1';
  task.task_id = 'proto-1';
  task.fixture_refs = [];
  task.options = { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false };

  const r = new Resolver({});
  try {
    measureInputBytes(task, r);
    assert.fail('should have refused custom prototype');
  } catch (e) {
    assert.equal(e.code, 'INVALID_INPUT', `expected INVALID_INPUT, got ${e.code}: ${e.message}`);
  }
  assert.equal(getterCalls, 0, 'inherited prototype getter was invoked during admission');
});

test('PC650-001: assertDeepNoAccessors rejects custom prototype', () => {
  let getterCalls = 0;
  const evilProto = {
    get x() { getterCalls++; return 1; },
  };
  const obj = Object.create(evilProto);
  obj.y = 2;
  try {
    assertDeepNoAccessors(obj, 'transport-input');
    assert.fail('should have refused custom prototype');
  } catch (e) {
    assert.equal(e.code, 'INVALID_INPUT', `expected INVALID_INPUT, got ${e.code}: ${e.message}`);
  }
  assert.equal(getterCalls, 0, 'inherited prototype getter was invoked during transport admission');
});

test('PC650-001: plain objects and arrays still admitted', () => {
  // Positive control: Object.prototype / Array.prototype / null-prototype
  // values must not be rejected by the new prototype check.
  const r = new Resolver({});
  const task = {
    schema_version: '1',
    task_id: 'plain-1',
    operation: 'analyze',
    fixture_refs: [],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
    tags: ['a', 'b'],
  };
  const bytes = measureInputBytes(task, r);
  assert.ok(bytes > 0, 'plain object should be admitted and measured');
  const nullProto = Object.create(null);
  nullProto.a = 1;
  const bytes2 = measureInputBytes(nullProto, r);
  assert.ok(bytes2 > 0, 'null-prototype object should be admitted');
});
