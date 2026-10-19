// spans.test.js — position-tracking JSON parser and span verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWithSpans, verifySpan } from '../src/spans.js';

test('spans track byte offsets for nested values', () => {
  const text = '{"a": 123, "b": {"c": "xy"}}';
  const { value, spans } = parseWithSpans(text);
  assert.deepEqual(value, { a: 123, b: { c: 'xy' } });
  const s = spans.get('$.a');
  assert.equal(text.slice(s.start, s.end), '123');
  const s2 = spans.get('$.b.c');
  assert.equal(text.slice(s2.start, s2.end), '"xy"');
});

test('spans handle arrays and unicode', () => {
  const text = '{"arr": [1, "héllo"], "u": "𝄞"}';
  const { value, spans } = parseWithSpans(text);
  assert.equal(value.arr[1], 'héllo');
  assert.equal(value.u, '𝄞');
  const s = spans.get('$.arr[1]');
  assert.equal(Buffer.from(text, 'utf8').toString('utf8', s.start, s.end), '"héllo"');
  // byte offsets, not char offsets: 'é' is 2 bytes
  const su = spans.get('$.u');
  const raw = Buffer.from(text, 'utf8').toString('utf8', su.start, su.end);
  assert.equal(raw, '"𝄞"');
  assert.ok(su.end - su.start > 3); // multibyte content
});

test('verifySpan checks quote equality under budget', () => {
  const text = '{"amount_minor": 500000}';
  const { spans } = parseWithSpans(text);
  const s = spans.get('$.amount_minor');
  let charged = 0;
  const ok = verifySpan(Buffer.from(text, 'utf8'),
    { byte_start: s.start, byte_end: s.end, quote: '500000' },
    () => { charged++; });
  assert.equal(charged, 1);
  assert.ok(ok.ok);
  const bad = verifySpan(Buffer.from(text, 'utf8'),
    { byte_start: s.start, byte_end: s.end, quote: '999' },
    () => {});
  assert.ok(!bad.ok);
});

test('verifySpan rejects out-of-bounds ranges', () => {
  const buf = Buffer.from('{}', 'utf8');
  let n = 0;
  const r = verifySpan(buf, { byte_start: 0, byte_end: 99, quote: '{}' }, () => { n++; });
  assert.ok(!r.ok);
  assert.equal(n, 1); // budget charged before checking
});

test('512/513 span boundary: 513th check refuses', () => {
  const text = '{"x": 1}';
  const { spans } = parseWithSpans(text);
  const s = spans.get('$.x');
  const buf = Buffer.from(text, 'utf8');
  let count = 0;
  const charge = () => {
    count++;
    if (count > 512) throw new Error('BUDGET_EXCEEDED');
  };
  for (let i = 0; i < 512; i++) {
    verifySpan(buf, { byte_start: s.start, byte_end: s.end, quote: '1' }, charge);
  }
  assert.throws(() => verifySpan(buf, { byte_start: s.start, byte_end: s.end, quote: '1' }, charge), /BUDGET_EXCEEDED/);
});

test('later-span-untouched: failed verification does not consume later spans', () => {
  const text = '{"a": 1, "b": 2}';
  const { spans } = parseWithSpans(text);
  const buf = Buffer.from(text, 'utf8');
  const sa = spans.get('$.a');
  const sb = spans.get('$.b');
  // wrong quote for a
  const ra = verifySpan(buf, { byte_start: sa.start, byte_end: sa.end, quote: '999' }, () => {});
  assert.ok(!ra.ok);
  // b still verifies independently
  const rb = verifySpan(buf, { byte_start: sb.start, byte_end: sb.end, quote: '2' }, () => {});
  assert.ok(rb.ok);
});
