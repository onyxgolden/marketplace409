import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJobDefinitions, generacDemoDefinition, generacReplayCorpus, loadFixtureCorpus } from "../src/jobs.js";
import { PRINCIPAL } from "./helpers.js";

function jobsDirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "research-workbench-jobs-"));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return dir;
}

function expectCode(fn, code) {
  let thrown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, `expected refusal ${code}, nothing thrown`);
  assert.equal(thrown.code, code, `expected ${code}, got ${thrown.code}: ${thrown.message}`);
  return thrown;
}

test("demo definition validates and the Generac replay corpus holds 8 items", () => {
  const def = generacDemoDefinition();
  assert.equal(def.job_id, "research-weekly-brief@1");
  assert.equal(def.status, "DISABLED");
  const corpus = generacReplayCorpus();
  assert.equal(corpus.corpus_id, "generac-7209-synthetic-replay");
  assert.equal(corpus.items.length, 8);
  for (const item of corpus.items) {
    assert.ok(["fact", "inference", "proposal"].includes(item.kind), `bad kind ${item.kind}`);
    assert.equal(typeof item.claim, "string");
    assert.equal(typeof item.evidence_excerpt, "string");
  }
  assert.equal(loadFixtureCorpus("small-corpus.json").corpus_id, "small-corpus");
  assert.equal(loadFixtureCorpus("empty-corpus.json").items.length, 0);
});

test("loads a directory of valid definitions, sorted by job_id", () => {
  const def = generacDemoDefinition();
  const dir = jobsDirWith({ "a.json": def, "b.json": { ...def, job_id: "research-daily-note@1", title: "Daily note" } });
  try {
    const jobs = loadJobDefinitions(dir, PRINCIPAL);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].job_id, "research-daily-note@1");
    assert.equal(jobs[1].job_id, "research-weekly-brief@1");
    assert.ok(Object.isFrozen(jobs));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a non-DISABLED definition instead of loading it", () => {
  const def = { ...generacDemoDefinition(), status: "ENABLED" };
  const dir = jobsDirWith({ "job.json": def });
  try {
    // validateJobDefinition itself refuses non-DISABLED first; either code proves the registry never serves it.
    let thrown = null;
    try {
      loadJobDefinitions(dir, PRINCIPAL);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown, "expected a refusal for a non-DISABLED definition");
    assert.ok(["BAD_JOB_DEFINITION", "NON_DISABLED_STATUS"].includes(thrown.code), `unexpected code ${thrown.code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a definition scoped to another operator or workspace", () => {
  const def = {
    ...generacDemoDefinition(),
    operator_scope: { operator_ref: "op-2", workspace_ref: "ws-1" },
  };
  const dir = jobsDirWith({ "job.json": def });
  try {
    expectCode(() => loadJobDefinitions(dir, PRINCIPAL), "BAD_JOB_DEFINITION");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses malformed JSON, an invalid definition, and a duplicate job_id", () => {
  const def = generacDemoDefinition();
  const badJson = jobsDirWith({ "job.json": "{ not json" });
  try {
    expectCode(() => loadJobDefinitions(badJson, PRINCIPAL), "BAD_JOB_DEFINITION");
  } finally {
    rmSync(badJson, { recursive: true, force: true });
  }
  const badDef = jobsDirWith({ "job.json": { ...def, job_id: "not-a-job-id" } });
  try {
    expectCode(() => loadJobDefinitions(badDef, PRINCIPAL), "BAD_JOB_DEFINITION");
  } finally {
    rmSync(badDef, { recursive: true, force: true });
  }
  const dup = jobsDirWith({ "a.json": def, "b.json": def });
  try {
    expectCode(() => loadJobDefinitions(dup, PRINCIPAL), "BAD_JOB_DEFINITION");
  } finally {
    rmSync(dup, { recursive: true, force: true });
  }
});

test("refuses a missing jobs directory instead of serving an empty list", () => {
  expectCode(() => loadJobDefinitions(join(tmpdir(), "research-workbench-no-such-dir"), PRINCIPAL), "JOB_DEFINITIONS_UNAVAILABLE");
});
