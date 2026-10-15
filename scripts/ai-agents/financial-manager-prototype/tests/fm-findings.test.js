/**
 * fm-findings.test.js — regressions for ChatGPT PR #626 review findings
 * FM-001 through FM-005 (+ Windows-path validation note).
 *
 * Each test fails at the reviewed head e8941528 and passes with the fix.
 * Synthetic fixtures only; no network; no model calls.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadStore, makeContext, run } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";
import { verifyCorpus } from "./verify-corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT = 256 * 1024;

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
// FM-001 — bundle-wide dedup
// ---------------------------------------------------------------------------

test("FM-001: identical cross-section copies count once in the rollup", () => {
  const l1 = line("L1", "expense", "1000", "900");
  const l2 = line("L1", "expense", "1000", "900", { source_labels: ["lbl-L1-b"] });
  const { ctx, ref } = registerFixture({ sections: [sec("s1", [l1]), sec("s2", [l2])] });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED");
  assert.equal(r.rollup.possible, true);
  // expense budget counted once, not twice
  assert.equal(r.rollup.totals.expense.budget_minor, "1000");
  assert.equal(r.rollup.totals.expense.actual_minor, "900");
  // labels from both copies retained on the surviving line
  const s1 = r.sections.find((s) => s.section_id === "s1");
  const kept = s1.amounts.lines.find((l) => l.line_id === "L1");
  assert.deepStrictEqual(kept.source_labels.sort(), ["lbl-L1", "lbl-L1-b"]);
  // the duplicate section carries no lines
  const s2 = r.sections.find((s) => s.section_id === "s2");
  assert.equal(s2.amounts.lines.length, 0);
});

test("FM-001: shuffled section order gives the identical rollup", () => {
  const mkLines = (suffix) => [
    line("L1", "expense", "1000", "900"),
    line("L1", "expense", "1000", "900", { source_labels: [`lbl-L1-${suffix}`] }),
  ];
  const fwd = registerFixture(
    { sections: [sec("s1", [mkLines("a")[0]]), sec("s2", [mkLines("b")[1]])] },
    "fwd"
  );
  const rev = registerFixture(
    { sections: [sec("s2", [mkLines("b")[1]]), sec("s1", [mkLines("a")[0]])] },
    "rev"
  );
  const r1 = run(taskFor([fwd.ref]), fwd.ctx);
  const r2 = run(taskFor([rev.ref]), rev.ctx);
  assert.deepStrictEqual(r1.rollup.totals, r2.rollup.totals);
  assert.equal(r1.rollup.totals.expense.budget_minor, "1000");
});

test("FM-001: conflicting cross-section copies become a contradiction with no aggregate", () => {
  const l1 = line("L1", "expense", "1000", "900");
  const l2 = line("L1", "expense", "2000", "900"); // same identity, different budget
  const { ctx, ref } = registerFixture({ sections: [sec("s1", [l1]), sec("s2", [l2])] });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.rollup.possible, false);
  const contra = r.exceptions.filter((e) => e.code === "CONTRADICTION");
  assert.ok(contra.length >= 2, "both sections contradicted");
  assert.ok(contra[0].alternatives.length >= 2, "alternatives retained");
  for (const s of r.sections) assert.equal(s.complete, false);
});

// ---------------------------------------------------------------------------
// FM-002 — disjoint summary rows
// ---------------------------------------------------------------------------

const summaryLine = (id, budget, actual) =>
  line(id, "expense", budget, actual, { flags: ["summary-row"] });

test("FM-002: proven-disjoint summaries are included exactly once", () => {
  const { ctx, ref } = registerFixture({
    sections: [
      sec("s1", [line("L1", "expense", "1000", "900"), summaryLine("S1", "500", "450")], {
        disjoint_proof: true,
      }),
    ],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED");
  const s1 = r.sections[0];
  assert.equal(s1.complete, true);
  // detail 1000 + disjoint summary 500
  assert.equal(s1.amounts.expense.budget_minor, "1500");
  assert.equal(s1.amounts.expense.actual_minor, "1350");
  assert.ok(s1.amounts.lines.some((l) => l.line_id === "S1"), "summary row present");
});

test("FM-002: summaries without proof are blocked", () => {
  const { ctx, ref } = registerFixture({
    sections: [sec("s1", [line("L1", "expense", "1000", "900"), summaryLine("S1", "500", "450")])],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.sections[0].complete, false);
  assert.ok(
    r.sections[0].diagnostics.some((d) => d.code === "UNVERIFIABLE_POPULATION"),
    "blocked with UNVERIFIABLE_POPULATION"
  );
});

test("FM-002: explicit false proof is blocked", () => {
  const { ctx, ref } = registerFixture({
    sections: [
      sec("s1", [line("L1", "expense", "1000", "900"), summaryLine("S1", "500", "450")], {
        disjoint_proof: false,
      }),
    ],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.sections[0].complete, false);
  assert.ok(r.sections[0].diagnostics.some((d) => d.code === "UNVERIFIABLE_POPULATION"));
});

test("FM-002: summary-only section includes its population", () => {
  const { ctx, ref } = registerFixture({
    sections: [sec("s1", [summaryLine("S1", "500", "450")])],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED");
  assert.equal(r.sections[0].amounts.expense.budget_minor, "500");
});

// ---------------------------------------------------------------------------
// FM-003 — rollup category semantics
// ---------------------------------------------------------------------------

test("FM-003: mixed-category rollup keeps revenue/expense separate with net income", () => {
  const { ctx, ref } = registerFixture({
    sections: [
      sec("s1", [line("R1", "revenue", "20000", "22000"), line("E1", "expense", "12000", "11000")]),
    ],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.rollup.possible, true);
  const t = r.rollup.totals;
  assert.equal(t.revenue.budget_minor, "20000");
  assert.equal(t.expense.budget_minor, "12000");
  // net income = revenue - expense, NOT revenue + expense
  assert.equal(t.net_income.budget_minor, "8000");
  assert.equal(t.net_income.actual_minor, "11000");
  assert.ok(!("budget_minor" in t), "no combined revenue-plus-expense figure");
});

test("FM-003: revenue-only and expense-only rollups", () => {
  const ro = registerFixture({ sections: [sec("s1", [line("R1", "revenue", "5000", "6000")])] }, "ro");
  const rr = run(taskFor([ro.ref]), ro.ctx);
  assert.equal(rr.rollup.totals.revenue.budget_minor, "5000");
  assert.equal(rr.rollup.totals.expense, null);
  assert.equal(rr.rollup.totals.net_income.budget_minor, "5000");

  const eo = registerFixture({ sections: [sec("s1", [line("E1", "expense", "3000", "2500")])] }, "eo");
  const er = run(taskFor([eo.ref]), eo.ctx);
  assert.equal(er.rollup.totals.revenue, null);
  assert.equal(er.rollup.totals.expense.budget_minor, "3000");
  assert.equal(er.rollup.totals.net_income.budget_minor, "-3000");
});

test("FM-003: multi-section mixed rollup is exact", () => {
  const { ctx, ref } = registerFixture({
    sections: [
      sec("s1", [line("R1", "revenue", "20000", "22000")], { period_start: "2026-01-01", period_end: "2026-01-31" }),
      sec("s2", [line("E1", "expense", "12000", "11000")], { period_start: "2026-02-01", period_end: "2026-02-28" }),
    ],
  });
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.rollup.possible, true);
  assert.equal(r.rollup.totals.revenue.budget_minor, "20000");
  assert.equal(r.rollup.totals.expense.actual_minor, "11000");
  assert.equal(r.rollup.totals.net_income.budget_minor, "8000");
  assert.deepStrictEqual(r.rollup.sections_included.sort(), ["s1", "s2"]);
});

// ---------------------------------------------------------------------------
// FM-005 — input cap covers resolved fixture bytes
// ---------------------------------------------------------------------------

test("FM-005: small task referencing an oversize fixture is INPUT_LIMIT", () => {
  const big = "x".repeat(LIMIT); // 256 KiB of fixture content
  const { ctx, ref } = registerFixture({
    sections: [sec("s1", [line("L1", "expense", "1000", "900", { source_labels: [big] })])],
  }, "big");
  const task = taskFor([ref]);
  const taskBytes = Buffer.byteLength(JSON.stringify(task), "utf8");
  assert.ok(taskBytes < 1024, `test setup: task envelope is tiny (${taskBytes}b)`);
  const r = run(task, ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  assert.deepStrictEqual(r.sections, [], "no partial domain result");
  assert.equal(r.rollup.totals, null);
});

test("FM-005: many large strings inside one valid section are INPUT_LIMIT", () => {
  const lines = Array.from({ length: 10 }, (_, i) =>
    line("L" + i, "expense", "1000", "900", { source_labels: ["y".repeat(30000)] })
  );
  const { ctx, ref } = registerFixture({ sections: [sec("s1", lines)] }, "many");
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, "INPUT_LIMIT");
  assert.deepStrictEqual(r.sections, []);
});

test("FM-005: fixture bytes just under the cap are accepted", () => {
  // size the label so task + canonical fixture bytes land well under 256 KiB
  // for BOTH input and output (labels echo into the output envelope)
  const store = loadStore();
  const base = { sections: [sec("s1", [line("L1")])] };
  const baseBytes = canonicalBytes(base).length;
  const pad = Math.floor(LIMIT / 2) - baseBytes - 2048; // ~128 KiB total
  assert.ok(pad > 0, "test setup");
  const content = { sections: [sec("s1", [line("L1", "expense", "1000", "900", { source_labels: ["z".repeat(pad)] })])] };
  const { ctx, ref } = registerFixture(content, "near");
  const r = run(taskFor([ref]), ctx);
  assert.equal(r.status, "ASSEMBLED", `expected ASSEMBLED, got ${r.status}: ${JSON.stringify(r.diagnostics[0])}`);
});

// ---------------------------------------------------------------------------
// FM-004 — separately trusted launcher root (end-to-end)
// ---------------------------------------------------------------------------

test("FM-004: candidate package.json carries no approval root", () => {
  // The vulnerability: npm scripts self-carried FM_APPROVED_ROOT, so a
  // candidate could tamper, re-pin, and rewrite its own root, making
  // `npm test` authenticate the tampered tree against its own declaration.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const [name, script] of Object.entries(pkg.scripts || {})) {
    assert.ok(
      !/FM_APPROVED_ROOT=/.test(String(script)),
      `script "${name}" must not self-carry the approval root`
    );
  }
});

test("FM-004: npm test fails closed with no host-supplied root", () => {
  // The launcher must require an externally supplied root and fail closed
  // when absent. At the vulnerable head, package.json self-carried the
  // root, so `npm test` on a pristine tree succeeded without host input.
  const dir = mkdtempSync(join(tmpdir(), "fm-launcher-"));
  try {
    cpSync(ROOT, dir, { recursive: true });
    const env = { ...process.env };
    delete env.FM_APPROVED_ROOT;
    const child = spawnSync("npm", ["test"], { cwd: dir, env, encoding: "utf8" });
    assert.equal(child.status, 3, `npm test must fail closed, got status ${child.status}`);
    assert.match(child.stderr + child.stdout, /trust failure/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FM-004: launcher fails closed with no root at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "fm-launcher-"));
  try {
    cpSync(ROOT, dir, { recursive: true });
    const env = { ...process.env };
    delete env.FM_APPROVED_ROOT;
    const child = spawnSync(process.execPath, ["tests/run-tests.js"], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    assert.equal(child.status, 3, `expected fail-closed exit 3, got ${child.status}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Windows-path validation note — platform-independent manifest paths
// ---------------------------------------------------------------------------

test("corpus: manifest paths validate independent of platform separators", () => {
  // forward-slash manifest entries must pass on every platform; backslashes
  // and dot segments must fail everywhere (no node:path.normalize)
  const good = verifyCorpus(ROOT, readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim());
  assert.equal(good.ok, true, `pristine tree must verify: ${good.reason}`);
  const dir = mkdtempSync(join(tmpdir(), "fm-path-"));
  try {
    cpSync(ROOT, dir, { recursive: true });
    const manifestPath = join(dir, "corpus", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    // simulate a Windows-authored manifest entry with backslashes
    manifest.files.push({ path: "src\\evil.js", sha256: "0".repeat(64) });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const v = verifyCorpus(dir, readFileSync(join(ROOT, "corpus", "corpus_digest.txt"), "utf8").trim());
    assert.equal(v.ok, false);
    assert.match(v.reason, /bad manifest entry/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
