// watchdog.test.js — PC650-007: external 5-second watchdog.
// Proves that runGuarded terminates hung workers and returns bounded refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runGuarded, GUARD_TIMEOUT_MS } from '../runner/run-guarded.js';

test('PC650-007: runGuarded returns result for normal task', async () => {
  const task = {
    schema_version: '1', task_id: 'watchdog-1', operation: 'analyze',
    fixture_refs: [], // empty refs will fail validation, but should not hang
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  const context = {
    clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
    principal: { id: 'test' }, grants: [], request_authority: 'muse-relay',
    fixtureStore: {},
  };
  const out = await runGuarded(task, context, 2000);
  // Should return a refusal (empty fixture_refs), not hang
  assert.equal(out.status, 'REFUSED');
  assert.equal(out.complete, false);
});

test('PC650-007: runGuarded rejects accessor in transport', async () => {
  const task = {
    schema_version: '1', task_id: 'watchdog-2', operation: 'analyze',
    fixture_refs: ['fx-1'],
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
  };
  // Define a getter that would hang if executed
  Object.defineProperty(task, 'evil', {
    enumerable: true,
    get() { while (true) {} },
  });
  const context = {
    clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
    principal: { id: 'test' }, grants: [], request_authority: 'muse-relay',
    fixtureStore: {},
  };
  const out = await runGuarded(task, context, 2000);
  // Transport admission should reject the getter before worker creation
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => d.code === 'TRANSPORT_REFUSED'));
});

test('PC650-007: runGuarded rejects hanging getter inside worker', async () => {
  // Use factorySource to create a task with a hanging getter inside the worker.
  // The parent never touches the malicious input. The worker's admission
  // should reject the getter WITHOUT executing it (descriptor-safe).
  const factorySource = `() => {
    const task = {
      schema_version: '1', task_id: 'hang-1', operation: 'analyze',
      fixture_refs: ['fx-1'],
      options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false },
    };
    // Install a hanging getter inside the worker
    Object.defineProperty(task, 'hang', {
      enumerable: true,
      get() { while (true) {} },
    });
    const context = {
      clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
      principal: { id: 'test' }, grants: [], request_authority: 'muse-relay',
      fixtureStore: {},
    };
    return { task, context };
  }`;
  const start = Date.now();
  const out = await runGuarded(null, null, 2000, factorySource);
  const elapsed = Date.now() - start;
  // Should refuse quickly (getter rejected, not executed), not hang
  assert.ok(elapsed < 5000, `took ${elapsed}ms, expected < 5000ms`);
  assert.equal(out.status, 'REFUSED');
  // The admission rejects the accessor with INVALID_INPUT
  assert.ok(out.diagnostics.some((d) => d.code === 'INVALID_INPUT' && /accessor/.test(d.reason)));
  assert.equal(out.complete, false);
  assert.deepEqual(out.report.packages, []);
});

test('PC650-007: GUARD_TIMEOUT_MS is 5000', () => {
  assert.equal(GUARD_TIMEOUT_MS, 5000);
});

test('PC650-007: runGuarded times out infinite loop in worker', async () => {
  // A true hang: the worker enters an infinite loop that admission cannot
  // statically detect. The external watchdog must terminate it.
  const factorySource = `() => {
    // Infinite loop inside the worker - blocks the event loop
    const start = Date.now();
    while (Date.now() - start < 10000) {} // 10s busy loop
    return { task: null, context: null };
  }`;
  const start = Date.now();
  // Note: factorySource bypasses transport admission, so the hang happens
  // inside the worker. The watchdog should fire at ~500ms.
  const out = await runGuarded(null, null, 500, factorySource);
  const elapsed = Date.now() - start;
  // Should timeout at ~500ms, not wait the full 10s
  assert.ok(elapsed < 5000, `took ${elapsed}ms, expected < 5000ms (watchdog at 500ms)`);
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => d.code === 'EXECUTION_TIMEOUT'));
  assert.equal(out.complete, false);
});
