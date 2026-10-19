// canonical.test.js — exact rational rounding + deterministic encoding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roundRational, formatMinor, formatRatio, canonicalStringify } from '../src/canonical.js';

test('roundRational half-away-from-zero: positive half rounds up', () => {
  assert.equal(roundRational(1n, 2n, 0), '1');   // 0.5 -> 1
  assert.equal(roundRational(1n, 2n, 2), '0.50');
  assert.equal(roundRational(3n, 2n, 0), '2');   // 1.5 -> 2
});

test('roundRational half-away-from-zero: negative half rounds away from zero', () => {
  assert.equal(roundRational(-1n, 2n, 0), '-1'); // -0.5 -> -1
  assert.equal(roundRational(-3n, 2n, 0), '-2'); // -1.5 -> -2
});

test('roundRational: just below half does not round up', () => {
  assert.equal(roundRational(4949n, 10000n, 2), '0.49');
  assert.equal(roundRational(4951n, 10000n, 2), '0.50');
});

test('formatMinor: cents to dollars', () => {
  assert.equal(formatMinor(12345), '123.45');
  assert.equal(formatMinor(-100000), '-1000.00');
  assert.equal(formatMinor(0), '0.00');
});

test('formatRatio: 4 decimals', () => {
  assert.equal(formatRatio(4n, 5n), '0.8000');
  assert.equal(formatRatio(1n, 3n), '0.3333');
  assert.equal(formatRatio(2n, 3n), '0.6667');
});

test('canonicalStringify: key order is stable regardless of insertion order', () => {
  const a = canonicalStringify({ z: 1, a: { d: 4, c: 3 } });
  const b = canonicalStringify({ a: { c: 3, d: 4 }, z: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":4},"z":1}');
});

test('roundRational: zero stays zero, no negative zero', () => {
  assert.equal(roundRational(0n, 5n, 2), '0.00');
});
