// run-battery.js — executes the frozen battery against src/index.js.
// PM651-008: Authenticates the manifest digest against a separately supplied
// host approval BEFORE importing the candidate or executing. The host root
// comes from --trust-root <sha256> or the PM_TRUST_ROOT env var. Absent or
// mismatched root refuses to run. The local corpus_digest.txt is NOT trusted.
// Usage: node tests/run-battery.js [--battery corpus/battery.json] [--trust-root <sha256>]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const sha256Str = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// 0. Host trust root (PM651-008). Must be supplied separately; the repo's
// own corpus_digest.txt is replaceable and is not an approval.
const args = process.argv.slice(2);
const trustIdx = args.indexOf('--trust-root');
const hostRoot = trustIdx >= 0 ? args[trustIdx + 1] : process.env.PM_TRUST_ROOT;
if (!hostRoot || !/^[0-9a-f]{64}$/.test(hostRoot)) {
  console.error('TRUST-BOOTSTRAP FAILED: no host trust root supplied (use --trust-root <sha256> or PM_TRUST_ROOT)');
  process.exit(2);
}

// 1. Manifest verification: digest must match the host-approved root.
const manifestRaw = readFileSync(join(root, 'corpus', 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestRaw);
// Canonical digest (same as freeze-corpus.js).
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const manifestDigest = sha256Str(canon(manifest));
if (manifestDigest !== hostRoot) {
  console.error(`TRUST-BOOTSTRAP FAILED: manifest digest ${manifestDigest} != host-approved root`);
  process.exit(2);
}

// 2. Every listed file hash verified.
const manifestEntries = Array.isArray(manifest) ? manifest : Object.entries(manifest.files || {}).map(([path, sha256]) => ({ path, sha256 }));
for (const e of manifestEntries) {
  const actual = sha256File(join(root, e.path));
  if (actual !== e.sha256) {
    console.error(`HASH MISMATCH: ${e.path} — refusing to run`);
    process.exit(2);
  }
}
console.log(`manifest verified (${manifestEntries.length} files, root ${hostRoot.slice(0, 12)}…)`);

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
  const isRelay = authority === 'muse-relay';
  const principalId = isRelay ? 'relay-op' : authority;
  const ctx = {
    clock: {}, criteria_version: '1',
    principal: { principal_id: principalId, kind: isRelay ? 'relay' : 'human' },
    grants: [{ grant_id: 'g1', principal_id: principalId, action: 'read', resource: { fixture_id: '*' } }],
    request_authority: authority, relay: null, fixtureStore: fixtures,
  };
  if (isRelay) {
    ctx.relay = { relay_id: 'muse-relay', delegate_principal_id: principalId, valid: true, scope: 'read-fixtures' };
  }
  return ctx;
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
