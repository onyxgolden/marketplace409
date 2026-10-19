// run-battery.js — executes corpus/battery.json against src/index.js.
// Verifies the pinned manifest + every constituent hash BEFORE any import of
// the candidate or execution. Reports pass/fail per case.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1. Manifest verification first.
const manifest = JSON.parse(readFileSync(join(root, 'corpus', 'manifest.json'), 'utf8'));
const manifestDigest = readFileSync(join(root, 'corpus', 'corpus_digest.txt'), 'utf8').trim();
if (sha256File(join(root, 'corpus', 'manifest.json')) !== manifestDigest) {
  console.error('MANIFEST DIGEST MISMATCH — refusing to run');
  process.exit(2);
}
for (const [rel, pinned] of Object.entries(manifest.files)) {
  const actual = sha256File(join(root, rel));
  if (actual !== pinned) {
    console.error(`HASH MISMATCH: ${rel} — refusing to run`);
    process.exit(2);
  }
}
console.log(`manifest verified (${Object.keys(manifest.files).length} files, digest ${manifestDigest.slice(0, 12)}…)`);

// 2. Import candidate only after verification.
const { run } = await import('../src/index.js');
const store = JSON.parse(readFileSync(join(root, 'fixtures', 'store.json'), 'utf8'));

function baseContext() {
  return {
    clock: { now: '2026-10-18T14:00:00Z' },
    criteria_version: 'controls-v1',
    principal: { id: 'battery-host' },
    grants: [],
    request_authority: 'muse-relay',
    fixtureStore: JSON.parse(JSON.stringify(store)),
  };
}

function contextFor(c) {
  const ctx = baseContext();
  if (c.ctx === 'ctx-bad-auth') ctx.request_authority = 'mallory';
  if (c.ctx === 'ctx-bad-clock') ctx.clock.now = 'not-a-date';
  if (c.ctx === 'ctx-tampered-pin') {
    // tamper the source_ref blob pin inside the stored record, keeping the
    // entry sha256 in sync so the failure surfaces as SOURCE_UNVERIFIED
    for (const k of Object.keys(ctx.fixtureStore)) {
      const rec = JSON.parse(ctx.fixtureStore[k].bytes);
      if (rec.source_ref) {
        rec.source_ref = { ...rec.source_ref, blob: 'f'.repeat(40) };
        const nb = JSON.stringify(rec);
        ctx.fixtureStore[k] = { ...ctx.fixtureStore[k], bytes: nb, sha256: sha256Of(nb) };
      }
    }
  }
  if (c.ctx === 'ctx-tampered-bytes') {
    // tamper the bytes of the FIRST referenced fixture (sha256 now stale)
    const ref = c.task.fixture_refs[0];
    const rec = JSON.parse(ctx.fixtureStore[ref].bytes);
    rec.label = 'TAMPERED';
    ctx.fixtureStore[ref] = { ...ctx.fixtureStore[ref], bytes: JSON.stringify(rec) };
  }
  return ctx;
}

function sha256Of(t) {
  return createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');
}

function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

const battery = JSON.parse(readFileSync(join(root, 'corpus', 'battery.json'), 'utf8'));
let pass = 0, fail = 0;
const failures = [];

for (const c of battery) {
  const label = c.case_id;
  try {
    const runOnce = () => run(JSON.parse(JSON.stringify(c.task)), contextFor(c));
    const out1 = runOnce();
    if (c.replay) {
      const out2 = runOnce();
      const out3 = runOnce();
      const s1 = JSON.stringify(out1), s2 = JSON.stringify(out2), s3 = JSON.stringify(out3);
      if (s1 !== s2 || s2 !== s3) throw new Error('replay not byte-identical');
    }
    const exp = c.expected;
    if (exp.status && out1.status !== exp.status) {
      throw new Error(`status ${out1.status} != expected ${exp.status} (diags: ${JSON.stringify(out1.diagnostics.map((d) => d.code))})`);
    }
    if (exp.diagCode) {
      const codes = out1.diagnostics.map((d) => d.code);
      if (!codes.includes(exp.diagCode)) throw new Error(`diag ${exp.diagCode} not in [${codes}]`);
    }
    for (const [path, want] of exp.checks || []) {
      const got = getPath(out1, path);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`check ${path}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    pass++;
  } catch (e) {
    fail++;
    failures.push(`${label}: ${e.message}`);
  }
}

console.log(`\n${pass}/${pass + fail} battery cases passed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures.slice(0, 25)) console.log(' -', f);
  if (failures.length > 25) console.log(` ... and ${failures.length - 25} more`);
  process.exit(1);
}
