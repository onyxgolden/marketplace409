// run-battery.js — executes the frozen battery against src/index.js.
// PM651-008: Authenticates the manifest digest against a separately supplied
// host approval BEFORE importing the candidate or executing. The host root
// comes from --trust-root <sha256> or the PM_TRUST_ROOT env var. Absent or
// mismatched root refuses to run. The local corpus_digest.txt is NOT trusted.
// PM651-009: Task execution is routed through the five-second watchdog host
// (runner/run-with-watchdog.js), not via synchronous run(). This proves the
// guarded path works for normal results, admission/resolver/compute hangs,
// boot failures, and cleanup.
// Usage: node tests/run-battery.js [--battery corpus/battery.json] [--trust-root <sha256>]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

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
// PM651-009: we do NOT import run() for direct synchronous execution.
// Task execution goes through the watchdog host below.
const { canonicalStringify } = await import('../src/canonical.js');

const batteryPath = (() => {
  // PM651-009: skip --trust-root <hash> when resolving the battery path.
  const filtered = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--trust-root') { i++; continue; }
    filtered.push(process.argv[i]);
  }
  return new URL(filtered[0] || '../corpus/battery.json', import.meta.url);
})();
const storePath = new URL('../fixtures/store.json', import.meta.url);
const battery = JSON.parse(readFileSync(batteryPath, 'utf8'));
const fixtures = JSON.parse(readFileSync(storePath, 'utf8')).fixtures;

/**
 * PM651-009: run a task through the five-second watchdog host.
 * Writes task/context to temp files, spawns runner/run-with-watchdog.js,
 * parses the envelope JSON from stdout. The watchdog enforces the timeout,
 * distinguishes BOOT_FAILURE from TIMEOUT, and cleans up temp files.
 * The host trust root is propagated via PM_TRUST_ROOT env var.
 */
function runViaWatchdog(task, ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-battery-'));
  try {
    const taskFile = join(dir, 'task.json');
    const ctxFile = join(dir, 'context.json');
    writeFileSync(taskFile, JSON.stringify(task));
    writeFileSync(ctxFile, JSON.stringify(ctx));
    // Propagate the trust root to the watchdog child via env.
    const childEnv = { ...process.env };
    if (hostRoot && !childEnv.PM_TRUST_ROOT) {
      childEnv.PM_TRUST_ROOT = hostRoot;
    }
    const result = spawnSync(process.execPath, [
      join(root, 'runner', 'run-with-watchdog.js'),
      taskFile, ctxFile,
    ], {
      encoding: 'utf8',
      timeout: 20000, // watchdog has 5s internal timeout; headroom for spawn
      env: childEnv,
    });
    if (result.error) {
      throw new Error(`watchdog spawn failed: ${result.error.message}`);
    }
    const out = (result.stdout || '').trim();
    if (!out) {
      throw new Error(`watchdog produced no output (stderr: ${(result.stderr || '').slice(0, 200)})`);
    }
    return JSON.parse(out);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

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
    // PM651-009: route through the five-second watchdog host.
    result = runViaWatchdog(c.task, ctxFor(c.authority));
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
    // PM651-009: replay also goes through the watchdog host.
    const again = runViaWatchdog(c.task, ctxFor(c.authority));
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
