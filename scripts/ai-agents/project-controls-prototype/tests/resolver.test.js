// resolver.test.js — budget charging, hash verification, depth limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Resolver, BudgetExceeded, gitBlobSha1 } from '../src/resolver.js';

import { createHash } from 'node:crypto';
const sha256Hex = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');

function storeOf(obj) {
  const bytes = JSON.stringify(obj);
  return { fx1: { bytes, sha256: sha256Hex(bytes), media_type: 'application/json' } };
}

test('resolve returns parsed record and charges one object', () => {
  const r = new Resolver(storeOf({ a: 1 }));
  const { record } = r.resolve('fx1');
  assert.deepEqual(record, { a: 1 });
  assert.equal(r.objectsCharged, 1);
});

test('65th distinct object throws BUDGET_EXCEEDED before inspection', () => {
  // PC650-001: the budget counts DISTINCT objects. Resolving the same
  // fixture repeatedly charges its entry once (idempotent).
  const r = new Resolver(storeOf({ a: 1 }));
  for (let i = 0; i < 10; i++) r.resolve('fx1');
  assert.equal(r.objectsCharged, 1); // same entry, charged once

  // 65 distinct objects refuse on the 65th
  const r2 = new Resolver({});
  const objs = [];
  for (let i = 0; i < 64; i++) {
    const o = { idx: i };
    objs.push(o);
    r2.chargeObject(o);
  }
  assert.equal(r2.objectsCharged, 64);
  assert.throws(() => r2.chargeObject({ idx: 64 }), (e) => e.code === 'BUDGET_EXCEEDED');
  assert.equal(r2.objectsCharged, 65);
});

test('re-charging the same object is idempotent', () => {
  const r = new Resolver(storeOf({ a: 1 }));
  const o = { x: 1 };
  r.chargeObject(o);
  r.chargeObject(o);
  r.chargeObject(o);
  assert.equal(r.objectsCharged, 1);
});

test('unknown fixture throws READ_DENIED', () => {
  const r = new Resolver(storeOf({ a: 1 }));
  assert.throws(() => r.resolve('nope'), (e) => e.code === 'READ_DENIED');
});

test('tampered bytes throw HASH_MISMATCH', () => {
  const s = storeOf({ a: 1 });
  s.fx1.bytes = JSON.stringify({ a: 2 });
  const r = new Resolver(s);
  assert.throws(() => r.resolve('fx1'), (e) => e.code === 'HASH_MISMATCH');
});

test('oversize input throws INPUT_LIMIT', () => {
  const big = 'x'.repeat(300 * 1024);
  const r = new Resolver(storeOf({ big }));
  assert.throws(() => r.resolve('fx1'), (e) => e.code === 'INPUT_LIMIT');
});

test('depth > 32 throws INVALID_INPUT', () => {
  let deep = { v: 0 };
  for (let i = 0; i < 40; i++) deep = { nest: deep };
  const r = new Resolver(storeOf(deep));
  assert.throws(() => r.resolve('fx1'), (e) => e.code === 'INVALID_INPUT');
});

test('span 513 throws BUDGET_EXCEEDED', () => {
  const r = new Resolver(storeOf({ a: 1 }));
  for (let i = 0; i < 512; i++) r.chargeSpan();
  assert.throws(() => r.chargeSpan(), (e) => e.code === 'BUDGET_EXCEEDED');
});

test('gitBlobSha1 matches git for a known value', () => {
  // printf 'hello\n' | git hash-object --stdin -> verified against real git
  assert.equal(gitBlobSha1('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
