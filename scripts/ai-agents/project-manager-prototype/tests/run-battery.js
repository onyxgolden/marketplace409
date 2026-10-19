// run-battery.js — executes the frozen battery against src/index.js.
// Verifies the pinned manifest + every constituent hash BEFORE importing
// the candidate or executing. Reports pass/fail per case.
// Usage: node tests/run-battery.js [--battery corpus/battery.json]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// 1. Manifest verification first.
const manifest = JSON.parse(readFileSync(join(root, 'corpus', 'manifest.json'), 'utf8'));
const manifestDigest = readFileSync(join(root, 'corpus', 'corpus_digest.txt'), 'utf8').trim();
const manifestEntries = Array.isArray(manifest) ? manifest : Object.entries(manifest.files || {}).map(([path, sha256]) => ({ path, sha256 }));
for (const e of manifestEntries) {
  const actual = sha256File(join(root, e.path));
  if (actual !== e.sha256) {
    console.error(`HASH MISMATCH: ${e.path} — refusing to run`);
    process.exit(2);
  }
}
console.log(`manifest verified (${manifestEntries.length} files)`);

// 2. Import candidate only after verification.
const { run } = await import('../src/index.js');
const { canonicalStringify } = await import('../src/canonical.js');

const batteryPath = new URL(process.argv[2] || '../corpus/battery.json', import.meta.url);
const storePath = new URL('../fixtures/store.json', import.meta.url);
const battery = JSON.parse(readFileSync(batteryPath, 'utf8'));
const fixtures = JSON.parse(readFileSync(storePath, 'utf8')).fixtures;

let pass = 0, fail = 0;
const failures = [];

function ctxFor(authority) {
  return {
    clock: {}, criteria_version: '1', principal: 'battery',
    grants: [], request_authority: authority, fixtureStore: fixtures,
  };
}

function checkFindingCodes(report, codes) {
  const all = [];
  for (const p of report?.plans || []) for (const f of p.findings || []) all.push(f.code);
  for (const d of (report?.diagnostics || [])) all.push(d.code);
  // top-level diagnostics live on envelope; check both
  return codes.every((c) => all.includes(c));
}

for (const c of battery) {
  const label = c.case_id;
  let result;
  try {
    result = run(c.task, ctxFor(c.authority));
  } catch (e) {
    fail++;
    failures.push(`${label}: threw ${e.message}`);
    continue;
  }
  const exp = c.expected;
  const problems = [];

  if (exp.status && result.status !== exp.status) {
    problems.push(`status ${result.status} != ${exp.status}`);
  }
  const rep = result.report?.plans?.[0];
  if (exp.math) {
    for (const [id, [es, ef]] of Object.entries(exp.math)) {
      const got = result.report?.plans?.[0]?.math?.[id];
      if (!got || got.es !== es || got.ef !== ef) {
        problems.push(`math.${id} got ${JSON.stringify(got)} want [${es},${ef}]`);
      }
    }
  }
  if (exp.mathNull && rep?.math !== null) problems.push('math should be null');
  if (exp.findings !== undefined) {
    const n = (rep?.findings || []).length;
    if (n !== exp.findings) problems.push(`findings ${n} != ${exp.findings}`);
  }
  if (exp.findingCodes) {
    // check envelope diagnostics + plan findings
    const codes = new Set();
    for (const d of result.diagnostics || []) codes.add(d.code);
    for (const p of result.report?.plans || []) for (const f of p.findings || []) codes.add(f.code);
    for (const want of exp.findingCodes) {
      if (!codes.has(want)) problems.push(`missing finding code ${want} (have ${[...codes].join(',')})`);
    }
  }
  if (exp.milestones) {
    for (const [mid, want] of Object.entries(exp.milestones)) {
      const got = rep?.milestones?.find((x) => x.milestone_id === mid)?.assessment;
      if (got !== want) problems.push(`milestone ${mid} ${got} != ${want}`);
    }
  }
  if (exp.orphans) {
    const got = rep?.orphans || [];
    if (JSON.stringify(got) !== JSON.stringify(exp.orphans)) {
      problems.push(`orphans ${JSON.stringify(got)} != ${JSON.stringify(exp.orphans)}`);
    }
  }
  if (exp.completion) {
    const got = rep?.completion;
    if (!got || got.complete !== exp.completion[0] || got.total !== exp.completion[1]) {
      problems.push(`completion ${JSON.stringify(got)} != ${exp.completion}`);
    }
  }
  if (exp.quarantined !== undefined) {
    const n = (result.quarantined_sources || []).length;
    if (n !== exp.quarantined) problems.push(`quarantined ${n} != ${exp.quarantined}`);
  }
  if (exp.draft && !result.report?.draft_summary) problems.push('draft_summary missing');
  if (exp.plans !== undefined) {
    const n = (result.report?.plans || []).length;
    if (n !== exp.plans) problems.push(`plans ${n} != ${exp.plans}`);
  }
  if (exp.replay) {
    const again = run(c.task, ctxFor(c.authority));
    if (canonicalStringify(again) !== canonicalStringify(result)) {
      problems.push('replay not byte-identical');
    }
  }

  if (problems.length) {
    fail++;
    failures.push(`${label}: ${problems.join('; ')}`);
  } else {
    pass++;
  }
}

console.log(`battery: ${pass} passed, ${fail} failed of ${battery.length}`);
if (failures.length) {
  for (const f of failures.slice(0, 20)) console.log('FAIL', f);
  process.exit(1);
}
