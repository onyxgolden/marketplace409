/**
 * fm-findings2.test.js — round-2 regressions for ChatGPT PR #626 re-review
 * residual findings (reviewed head 3a374a05).
 *
 * FM-001 residual: bundle dedup must not launder a duplicate-only section
 *   into verified empty evidence — preserve each section's own labels,
 *   weakest support and flags; explicit dedup_links.
 * FM-004 residual: the authenticated entrypoint must never execute
 *   candidate code before trust authentication — builtins-only bootstrap;
 *   candidate npm metadata is not a trust entrypoint.
 * FM-005 residual: operation budgets charge pre-dedup consulted work;
 *   adversarial input depth refuses by name instead of throwing.
 *
 * Synthetic fixtures only; no network; no model calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadStore, makeContext, run } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT = 256 * 1024;
const APPROVED_ROOT = readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim();

function registerFixture(content, id = "t") {
  const store = loadStore();
  const blob = gitBlobSha1(canonicalBytes(content));
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path: `fixtures/financial-manager/${id}.json`,
    commit: "d".repeat(40),
    blob,
    algorithm: "git-sha1",
    revision: "1",
  };
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { [id]: { source_ref: ref, content } } };
  return { ctx, ref };
}

const line = (id, category = "expense", budget = "1000", actual = "900", extra = {}) => ({
  line_id: id,
  category,
  budget_minor: budget,
  actual_minor: actual,
  source_labels: [`lbl-${id}`],
  support_strength: "verified",
  flags: [],
  ...extra,
});

const sec = (id, lines, opts = {}) => ({
  section_id: id,
  currency: "USD",
  minor_unit_scale: 2,
  population_id: opts.population_id || "pop-fm",
  period_start: opts.period_start || "2026-01-01",
  period_end: opts.period_end || "2026-01-31",
  lines,
  claimed_totals: [],
  narrative_claims: [],
  ...(opts.disjoint_proof !== undefined ? { disjoint_proof: opts.disjoint_proof } : {}),
});

const taskFor = (refs, taskId = "t") => ({
  task_id: taskId,
  bundle_refs: refs,
  period_ids: [],
  requested_action: "assemble_draft",
});

// ---------------------------------------------------------------------------
// FM-001 residual — no fabricated verified empty section evidence
// ---------------------------------------------------------------------------

test("FM-001r: duplicate-only section keeps its own labels/flags/support, not verified-empty", () => {
  // The re-review's fresh probe: identical line in A and B; B's copy has
  // its own labels, null support, and a contradicted flag.
  const lA = line("L", "expense", "1000", "900", {
    source_labels: ["A"],
    support_strength: null,
    flags: ["mismatch"],
  });
  const lB = line("L", "expense", "1000", "900", {
    source_labels: ["B"],
    support_strength: null,
    flags: ["contradicted"],
  });
  const { ctx, ref } = registerFixture({ sections: [sec("secA", [lA]), sec("secB", [lB])] }, "fm001r");
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED");

  const sB = r.sections.find((s) => s.section_id === "secB");
  // B's evidence is preserved, not laundered into verified emptiness.
  assert.deepStrictEqual(sB.source_labels, ["B"], "B keeps its own labels");
  assert.equal(sB.support_strength, "unverifiable", "no support upgrade for B");
  assert.ok(sB.flags.includes("contradicted"), "B keeps its own flags");
  assert.equal(sB.amounts.lines.length, 0, "B counts no money");
  assert.deepStrictEqual(
    sB.dedup_links,
    [{ line_id: "L", counted_in_section: "secA" }],
    "explicit canonical link, non-counting"
  );

  // Money still counted exactly once; canonical section keeps unions.
  const sA = r.sections.find((s) => s.section_id === "secA");
  assert.deepStrictEqual(sA.source_labels.sort(), ["A", "B"]);
  assert.equal(r.rollup.totals.expense.budget_minor, "1000");
  assert.equal(r.rollup.totals.expense.actual_minor, "900");
});

test("FM-001r: reversed section order swaps the canonical holder, rollup identical", () => {
  const mk = (lbl, sup) =>
    line("L", "expense", "1000", "900", { source_labels: [lbl], support_strength: sup });
  const fwd = registerFixture(
    { sections: [sec("s1", [mk("one", "verified")]), sec("s2", [mk("two", "attributed")])] },
    "fwd"
  );
  const rev = registerFixture(
    { sections: [sec("s2", [mk("two", "attributed")]), sec("s1", [mk("one", "verified")])] },
    "rev"
  );
  const r1 = run(taskFor([fwd.ref]), fwd.ctx);
  const r2 = run(taskFor([rev.ref]), rev.ctx);
  assert.deepStrictEqual(r1.rollup.totals, r2.rollup.totals, "rollup identical under reversal");

  // Reversed: s2 is first in bundle order, so s2 counts the money and s1 links.
  const rs1 = r2.sections.find((s) => s.section_id === "s1");
  const rs2 = r2.sections.find((s) => s.section_id === "s2");
  assert.equal(rs2.amounts.lines.length, 1, "first-in-bundle section counts");
  assert.equal(rs1.amounts.lines.length, 0);
  assert.deepStrictEqual(rs1.dedup_links, [{ line_id: "L", counted_in_section: "s2" }]);
  assert.deepStrictEqual(rs1.source_labels, ["one"], "reversed section keeps its own label");
  assert.equal(rs1.support_strength, "verified", "reversed section keeps its OWN verified support (not upgraded, not downgraded)");
});

test("FM-001r: attributed/null support never upgrades; weakest wins per section", () => {
  const l1 = line("L", "expense", "1000", "900", { source_labels: ["x"], support_strength: "attributed" });
  const l2 = line("L", "expense", "1000", "900", { source_labels: ["y"], support_strength: null });
  const { ctx, ref } = registerFixture({ sections: [sec("s1", [l1]), sec("s2", [l2])] }, "sup");
  const r = run(taskFor([ref]), ctx);
  const s1 = r.sections.find((s) => s.section_id === "s1");
  const s2 = r.sections.find((s) => s.section_id === "s2");
  // Canonical merged line takes the minimum rank (null -> unverifiable).
  assert.equal(s1.amounts.lines[0].support_strength, "unverifiable");
  assert.equal(s1.support_strength, "unverifiable");
  // Duplicate section keeps its own (null -> unverifiable), not upgraded.
  assert.equal(s2.support_strength, "unverifiable");
  assert.deepStrictEqual(s2.source_labels, ["y"]);
});

test("FM-001r: narrative claim referencing a deduplicated line still verifies arithmetically", () => {
  const l1 = line("L", "expense", "1000", "700", { source_labels: ["a"] });
  const l2 = line("L", "expense", "1000", "700", { source_labels: ["b"] });
  const claim = {
    claim_id: "c1",
    kind: "movement",
    metric: "variance",
    direction: "down",
    line_ids: ["L"],
    quoted_text: "spend moved down",
    basis_refs: [],
  };
  const s2 = sec("s2", [l2]);
  s2.narrative_claims = [claim];
  const { ctx, ref } = registerFixture({ sections: [sec("s1", [l1]), s2] }, "claim");
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED");
  const rs2 = r.sections.find((s) => s.section_id === "s2");
  const nr = rs2.narrative_results.find((n) => n.claim_id === "c1");
  assert.equal(nr.state, "verified", "claim on deduplicated line verifies against the section's own copy");
  assert.equal(nr.arithmetic_verified, true);
});

// ---------------------------------------------------------------------------
// FM-004 residual — builtins-only bootstrap; npm metadata is not a trust entrypoint
// ---------------------------------------------------------------------------

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), "fm-r2-"));
  cpSync(ROOT, dir, { recursive: true });
  return dir;
}

function runOfficialEntrypoint(dir, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  return spawnSync(process.execPath, ["tests/run-tests.js"], {
    cwd: dir,
    env,
    encoding: "utf8",
  });
}

test("FM-004r: canary in the scored verifier helper never executes via the official entrypoint", () => {
  // The re-review's fresh probe: a top-level canary write appended to
  // tests/verify-corpus.js. The old launcher statically imported that
  // helper pre-verification, so the canary fired before the hash check.
  const dir = freshCopy();
  const marker = join(dir, "canary-verify-helper.txt");
  try {
    const p = join(dir, "tests", "verify-corpus.js");
    writeFileSync(
      p,
      readFileSync(p, "utf8") + `\nwriteFileSync(${JSON.stringify(marker)}, "canary");\n`
    );
    const child = runOfficialEntrypoint(dir, { FM_APPROVED_ROOT: APPROVED_ROOT });
    assert.equal(child.status, 3, `expected fail-closed exit 3, got ${child.status}`);
    assert.match(child.stderr + child.stdout, /trust failure/i);
    assert.equal(existsSync(marker), false, "verifier-helper canary must never execute");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FM-004r: canary in candidate npm metadata never executes via the official entrypoint", () => {
  // The re-review's second probe: package.json scripts.test rewritten to a
  // canary, invoked via `npm test`. npm authenticates nothing, so no
  // candidate-tree change can make `npm test` a trust boundary — the fix
  // (per the verdict's alternative) is that npm is NOT the trust
  // entrypoint: the authenticated launcher is `node tests/run-tests.js`
  // (see README.md), and package.json is now covered by the digest itself
  // (previously only hash-pinned with a circularity exclusion).
  // This test pins that the official entrypoint detects npm-metadata
  // tamper (exit 3) and never delegates to npm, so the canary cannot fire
  // through the trust path.
  const dir = freshCopy();
  const marker = join(dir, "canary-npm.txt");
  try {
    const p = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    pkg.scripts.test = `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)},'canary')"`;
    writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
    const child = runOfficialEntrypoint(dir, { FM_APPROVED_ROOT: APPROVED_ROOT });
    assert.equal(child.status, 3, `expected fail-closed exit 3, got ${child.status}`);
    assert.match(child.stderr + child.stdout, /trust failure/i);
    try {
      readFileSync(marker, "utf8");
      assert.fail("npm-metadata canary executed through the official entrypoint");
    } catch (e) {
      assert.equal(e.code, "ENOENT", "canary marker must not exist");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FM-004r: canary in scored src never executes via the official entrypoint", () => {
  const dir = freshCopy();
  const marker = join(dir, "canary-src.txt");
  try {
    const p = join(dir, "src", "index.js");
    writeFileSync(
      p,
      readFileSync(p, "utf8") + `\nimport { writeFileSync as __w } from "node:fs";\n__w(${JSON.stringify(marker)}, "canary");\n`
    );
    const child = runOfficialEntrypoint(dir, { FM_APPROVED_ROOT: APPROVED_ROOT });
    assert.equal(child.status, 3, `expected fail-closed exit 3, got ${child.status}`);
    try {
      readFileSync(marker, "utf8");
      assert.fail("src canary executed through the official entrypoint");
    } catch (e) {
      assert.equal(e.code, "ENOENT", "canary marker must not exist");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FM-004r: pristine tree passes the official entrypoint with the host root", () => {
  const dir = freshCopy();
  try {
    const child = runOfficialEntrypoint(dir, { FM_APPROVED_ROOT: APPROVED_ROOT });
    assert.equal(child.status, 0, `pristine tree must pass, got ${child.status}: ${child.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// FM-005 residual — pre-dedup budget charging; bounded traversal depth
// ---------------------------------------------------------------------------

test("FM-005r: 600 duplicate lines across 60 sections are BUDGET_EXCEEDED (pre-dedup charge)", () => {
  // The re-review's probe: 60 sections x 10 identical lines (99,612 bytes,
  // under the byte cap) traversed 600 line objects / 600 label spans.
  // Post-dedup counting saw only the survivors; pre-dedup charging must
  // refuse with BUDGET_EXCEEDED and no partial domain output.
  const sections = Array.from({ length: 60 }, (_, i) =>
    sec(
      "s" + i,
      Array.from({ length: 10 }, () => line("L"))
    )
  );
  const { ctx, ref } = registerFixture({ sections }, "fm005a");
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "BUDGET_EXCEEDED");
  assert.deepStrictEqual(r.sections, [], "no partial domain result");
  assert.equal(r.rollup.totals, null);
  assert.match(r.diagnostics[0].reason, /600|resolutions/);
});

test("FM-005r: 12000-deep nested fixture refuses INPUT_TOO_DEEP instead of throwing", () => {
  // The re-review's probe: a 12,000-level nested object plus sections:[].
  // canonicalize() is recursive; the depth bound must refuse by name
  // before any recursive traversal (no RangeError, no partial output).
  // Canonical bytes are authored iteratively (sorted keys) so the blob
  // pin is correct — the refusal is on depth, not on hash.
  const DEPTH = 12000;
  const nestChain = '{"nest":'.repeat(DEPTH) + "null" + "}".repeat(DEPTH);
  const canonStr = '{"payload":' + nestChain + ',"sections":[]}';
  const bytes = Buffer.from(canonStr, "utf8");
  const blob = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
  let deep = {};
  let cur = deep;
  for (let i = 0; i < DEPTH; i++) {
    cur.nest = {};
    cur = cur.nest;
  }
  const content = { sections: [], payload: deep };
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path: "fixtures/financial-manager/deep.json",
    commit: "d".repeat(40),
    blob,
    algorithm: "git-sha1",
    revision: "1",
  };
  const ctx = makeContext(loadStore());
  ctx.fixtureStore = { fixtures: { deep: { source_ref: ref, content } } };
  let r;
  assert.doesNotThrow(() => {
    r = run(taskFor([ref], "deep"), ctx);
  }, "deep input must not throw RangeError");
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_TOO_DEEP");
  assert.deepStrictEqual(r.sections, [], "no partial domain result");
});

test("FM-005r: input byte cap is byte-exact at 256 KiB (boundary and +1)", () => {
  // Padding lives in population_id: counted in canonical fixture bytes
  // but never echoed into the output envelope, isolating the INPUT cap.
  const build = (pop, id) => {
    const content = { sections: [sec("s1", [line("L1")], { population_id: pop })] };
    const blob = gitBlobSha1(canonicalBytes(content));
    const ref = {
      repo: "forge-ai-drop-fixtures",
      path: `fixtures/financial-manager/${id}.json`,
      commit: "d".repeat(40),
      blob,
      algorithm: "git-sha1",
      revision: "1",
    };
    const taskBytes = Buffer.byteLength(JSON.stringify(taskFor([ref])), "utf8");
    const fixtureBytes = canonicalBytes(content).length;
    return { ref, content, total: taskBytes + fixtureBytes };
  };
  const c0 = build("p", "cap");
  // population_id occurs once in canonical JSON; growing it by N grows
  // canonical bytes by exactly N.
  const padLen = LIMIT - c0.total + 1;
  assert.ok(padLen > 0, "test setup: padding must be positive");
  const atCap = build("p".repeat(padLen), "cap");
  assert.equal(atCap.total, LIMIT, "total input bytes land exactly on the cap");
  const store = loadStore();
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { cap: { source_ref: atCap.ref, content: atCap.content } } };
  const r = run(taskFor([atCap.ref]), ctx);
  assert.notEqual(r.diagnostics[0]?.code, "INPUT_LIMIT", "exactly-at-cap input is accepted");

  const overCap = build("p".repeat(padLen + 1), "cap");
  assert.equal(overCap.total, LIMIT + 1, "total input bytes land exactly one over the cap");
  const ctx2 = makeContext(store);
  ctx2.fixtureStore = { fixtures: { cap: { source_ref: overCap.ref, content: overCap.content } } };
  const r2 = run(taskFor([overCap.ref]), ctx2);
  assert.equal(r2.status, "REFUSED");
  assert.equal(r2.diagnostics[0].code, "INPUT_LIMIT");
  assert.deepStrictEqual(r2.sections, [], "no partial domain result");
});
