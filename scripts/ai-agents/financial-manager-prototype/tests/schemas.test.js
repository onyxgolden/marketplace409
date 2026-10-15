/**
 * schemas.test.js — malformed inputs produce structured denials
 * (status REFUSED + INVALID_INPUT), never exceptions or default success.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, makeContext, run } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

const REF = (over = {}) => ({
  repo: "forge-ai-drop-fixtures",
  path: "fixtures/financial-manager/fm-01.json",
  commit: "a".repeat(40),
  blob: "b".repeat(40),
  algorithm: "git-sha1",
  revision: "1",
  ...over,
});

function deniedFor(taskMods, ctxMods) {
  const store = loadStore();
  const ctx = { ...makeContext(store), ...(ctxMods || {}) };
  const task = {
    task_id: "t-schema",
    bundle_refs: [REF()],
    period_ids: [],
    requested_action: "assemble_draft",
    ...(taskMods || {}),
  };
  return run(task, ctx);
}

function expectInvalid(res, fragment) {
  assert.equal(res.status, "REFUSED");
  assert.equal(res.diagnostics[0].code, "INVALID_INPUT");
  assert.ok(
    res.diagnostics[0].reason.includes(fragment),
    `reason should mention ${fragment}: ${res.diagnostics[0].reason}`
  );
  assert.deepStrictEqual(res.sections, []);
}

/** Register tampered content under a recomputed blob so section schema is what fails. */
function ctxWithTamperedContent(store, fixtureId, mutate) {
  const src = store.fixtures[fixtureId];
  const content = JSON.parse(JSON.stringify(src.content));
  mutate(content);
  const ref = { ...src.source_ref, blob: gitBlobSha1(canonicalBytes(content)) };
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { tampered: { source_ref: ref, content } } };
  return { ctx, ref };
}

test("schemas: non-object task", () => {
  const r = run(null, makeContext(loadStore()));
  expectInvalid(r, "must be an object");
});

test("schemas: unknown property rejected", () => {
  const r = deniedFor({ extra: 1 });
  expectInvalid(r, "unknown property");
});

test("schemas: missing task_id", () => {
  const t = { bundle_refs: [REF()], period_ids: [], requested_action: "assemble_draft" };
  const r = run(t, makeContext(loadStore()));
  expectInvalid(r, "task_id");
});

test("schemas: empty bundle_refs", () => {
  const r = deniedFor({ bundle_refs: [] });
  expectInvalid(r, "bundle_refs");
});

test("schemas: malformed commit pin", () => {
  const r = deniedFor({ bundle_refs: [REF({ commit: "abc" })] });
  expectInvalid(r, "commit");
});

test("schemas: malformed blob pin", () => {
  const r = deniedFor({ bundle_refs: [REF({ blob: "ZZZ" })] });
  expectInvalid(r, "blob");
});

test("schemas: wrong algorithm", () => {
  const r = deniedFor({ bundle_refs: [REF({ algorithm: "sha256" })] });
  expectInvalid(r, "algorithm");
});

test("schemas: traversal path rejected", () => {
  const r = deniedFor({ bundle_refs: [REF({ path: "../evil.json" })] });
  expectInvalid(r, "traversal");
});

test("schemas: invalid clock", () => {
  const r = deniedFor(null, { clock: "not-a-date" });
  expectInvalid(r, "clock");
});

test("schemas: impossible date 2026-02-30 in section", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].period_start = "2026-02-30";
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "period_start");
});

test("schemas: bad enum category in line", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].lines[0].category = "profit";
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "category");
});

test("schemas: bad amount shape in line", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].lines[0].budget_minor = "12.50";
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "budget_minor");
});

test("schemas: zero denominator rational rejected", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].lines[0].budget_minor = { numerator: "1", denominator: "0" };
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "budget_minor");
});

test("schemas: duplicate section_ids denied", () => {
  const store = loadStore();
  const ctx = makeContext(store);
  const dup = {
    task_id: "t",
    bundle_refs: [store.fixtures["fm-01"].source_ref, store.fixtures["fm-01"].source_ref],
    period_ids: [],
    requested_action: "assemble_draft",
  };
  const r = run(dup, ctx);
  expectInvalid(r, "duplicate section_id");
});

test("schemas: unknown section property denied", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].bogus = true;
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "unknown property");
});

test("schemas: duplicate claim_ids denied", () => {
  const store = loadStore();
  const { ctx, ref } = ctxWithTamperedContent(store, "fm-01", (c) => {
    c.sections[0].narrative_claims.push({ ...c.sections[0].narrative_claims[0] });
  });
  const r = run(
    { task_id: "t", bundle_refs: [ref], period_ids: [], requested_action: "assemble_draft" },
    ctx
  );
  expectInvalid(r, "duplicate claim_id");
});
