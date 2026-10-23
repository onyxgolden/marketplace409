/**
 * trust-launcher.test.js — frozen regressions for P666-004A.1.
 *
 * The in-tree verifier (runner/trust-entry.mjs) is candidate code:
 * invoking it directly evaluates its top-level before
 * authenticateWiring() can run, so a modified verifier can execute a
 * canary or falsify the checks first. The SUPPORTED first verifier is
 * the host-owned launcher OUTSIDE the candidate tree (drop repo:
 * tools/trusted-launcher/launch.mjs), which authenticates the closure
 * read-only — including the verifier's own bytes — before ANY
 * candidate module is evaluated, and never evaluates the verifier
 * at all.
 *
 * Each test spawns the launcher as a child process against the live
 * wiring tree, mutating one pinned file at a time (restored in a
 * finally, exactly like the reviewer's probes) and asserting:
 *   - exit code 3 (trust failure), and
 *   - ZERO pre-auth execution: a canary in the mutated file must
 *     never run (its sentinel file must not exist).
 *
 * The launcher is located via TRUSTED_LAUNCHER, defaulting to the
 * drop repo sibling of this checkout; the suite skips if it is
 * absent. The host trust root rides the test process's own
 * environment (RENTAL_OPS_TRUST_ROOT) — the launcher refuses to read
 * it from the candidate tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const REPO_ROOT = normalize(join(WIRING_ROOT, "..", "..", ".."));
const LAUNCHER = process.env.TRUSTED_LAUNCHER
  ?? join(REPO_ROOT, "..", "..", "forge-ai-drop", "tools", "trusted-launcher", "launch.mjs");
const HOST_ROOT = process.env.RENTAL_OPS_TRUST_ROOT;

const haveLauncher = existsSync(LAUNCHER);

function spawnLauncher({ entry = "tests/trust-ping.mjs", trustRoot = HOST_ROOT, dropRoot = false } = {}) {
  const env = { ...process.env };
  if (dropRoot) delete env.RENTAL_OPS_TRUST_ROOT;
  else if (trustRoot !== undefined) env.RENTAL_OPS_TRUST_ROOT = trustRoot;
  try {
    const out = execFileSync(process.execPath,
      [LAUNCHER, "--wiring-root", WIRING_ROOT, "--entry", entry],
      { env, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Append `canary` to `rel`, run fn, then restore the original bytes. */
function withMutation(rel, canary, fn) {
  const abs = join(WIRING_ROOT, rel);
  const original = readFileSync(abs, "utf8");
  const sentinel = join(mkdtempSync(join(tmpdir(), "canary-")), "fired");
  const canarySrc = `\n;await import("node:fs").then((m) => m.appendFileSync(${JSON.stringify(sentinel)}, "x"));${canary}\n`;
  writeFileSync(abs, original + canarySrc);
  try {
    return fn(sentinel);
  } finally {
    writeFileSync(abs, original);
    rmSync(dirname(sentinel), { recursive: true, force: true });
  }
}

/** Surgically rewrite `rel` (string replace), run fn, restore. */
function withRewrite(rel, from, to, fn) {
  const abs = join(WIRING_ROOT, rel);
  const original = readFileSync(abs, "utf8");
  assert.ok(original.includes(from), `rewrite anchor not found in ${rel}`);
  writeFileSync(abs, original.replace(from, to));
  try {
    return fn();
  } finally {
    writeFileSync(abs, original);
  }
}

const sentinelFired = (sentinel) => {
  try { readFileSync(sentinel); return true; } catch { return false; }
};

test("trust launcher: happy path reaches an authenticated entry", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  assert.ok(HOST_ROOT, "RENTAL_OPS_TRUST_ROOT must be set to run the trust suite");
  const r = spawnLauncher();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /trust-ping-ok/);
});

test("trust launcher: a canary in the candidate verifier itself never executes (P666-004A.1)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  // THE counterexample from the verdict: trust-entry.mjs is evaluated
  // by Node before it can authenticate anything. The host launcher
  // must refuse on the verifier's bytes without ever evaluating them.
  const r = withMutation("runner/trust-entry.mjs", "", (sentinel) => {
    const res = spawnLauncher();
    return { res, fired: sentinelFired(sentinel) };
  });
  assert.equal(r.res.code, 3, r.res.out);
  assert.match(r.res.out, /digest mismatch/);
  assert.equal(r.fired, false, "canary in trust-entry.mjs EXECUTED — the verifier ran before authentication");
});

test("trust launcher: a falsified verifier cannot lie its way past the host root", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  // Surgically neuter the verifier's own digest comparison: if the
  // host trusted the verifier's behavior instead of its bytes, this
  // file would now report success. The launcher pins the bytes, so
  // the neutered verifier is refused before it is ever evaluated.
  const r = withRewrite(
    "runner/trust-entry.mjs",
    "if (actual !== expectedDigest) failures.push(`${rel}: digest mismatch`);",
    "if (false) failures.push(`${rel}: digest mismatch`); // FALSIFIED",
    () => spawnLauncher(),
  );
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /digest mismatch/);
});

test("trust launcher: a canary in bootstrap.mjs never executes (digest mismatch -> exit 3)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const r = withMutation("runner/bootstrap.mjs", "", (sentinel) => {
    const res = spawnLauncher();
    return { res, fired: sentinelFired(sentinel) };
  });
  assert.equal(r.res.code, 3, r.res.out);
  assert.match(r.res.out, /digest mismatch/);
  assert.equal(r.fired, false, "canary in bootstrap.mjs EXECUTED before the trust refusal");
});

test("trust launcher: a mutated manifest.json fails the host root comparison (exit 3)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const r = withRewrite(
    "runner/manifest.json",
    '"schema": "rental-ops-wiring-manifest@2"',
    '"schema": "rental-ops-wiring-manifest@2-tampered"',
    () => spawnLauncher(),
  );
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /trust root mismatch/);
});

test("trust launcher: no host trust root fails closed (exit 3)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const r = spawnLauncher({ dropRoot: true });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /no host trust root/);
});

test("trust launcher: a wrong host trust root is refused (exit 3)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const r = spawnLauncher({ trustRoot: "0".repeat(64) });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /trust root mismatch/);
});

test("trust launcher: an entry outside the authenticated manifest is refused (exit 3)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const r = spawnLauncher({ entry: "tests/zz-unlisted.test.js" });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /not an authenticated manifest member/);
});

test("trust launcher: the launcher imports only node: builtins (host-owned, independently evaluable)", (t) => {
  if (!haveLauncher) { t.skip("TRUSTED_LAUNCHER not present"); return; }
  const src = readFileSync(LAUNCHER, "utf8");
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "expected static imports in the launcher");
  for (const spec of imports) {
    assert.match(spec, /^node:/, `launcher imports non-builtin '${spec}' — it must stay builtins-only`);
  }
  assert.ok(!/from\s+["']\.\//.test(src) || true, "relative imports checked below");
  const relImports = [...src.matchAll(/from\s+["'](\.[^"']*)["']/g)].map((m) => m[1]);
  assert.deepEqual(relImports, [], `launcher has relative imports ${JSON.stringify(relImports)} — it must be self-contained`);
});
