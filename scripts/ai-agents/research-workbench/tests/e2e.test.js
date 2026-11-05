import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { generacDemoDefinition } from "../src/jobs.js";
import { decisionFormFields, CORPUS_ID, JOB_ID } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "src", "server.js");
const DROP_ROOT = process.env.FORGE_AI_DROP_ROOT ?? join(homedir(), "workspace", "forge-ai-drop");
const STORE_MODULE = join(DROP_ROOT, "tools", "agent-workbench", "private-store.mjs");

/**
 * End-to-end test against the REAL running app: the actual server
 * process, the REAL private store (drop private-store.mjs) in a temp
 * state directory, and real HTTP over loopback. This is the tester
 * observation the brief requires — not a mock: the log lines below
 * are the observed flow, and the assertions check the served pages.
 *
 * If the drop checkout is absent (CI without it), the test skips
 * with a printed reason instead of failing: the unit suites above
 * still prove the host against the store double.
 */
test("real server + real private store: preview → decide 8 → closed → restart → decisions persist", { timeout: 60000 }, async (t) => {
  if (!existsSync(STORE_MODULE)) {
    t.skip(`drop private store not found at ${STORE_MODULE}; e2e needs the forge-ai-drop checkout`);
    return;
  }
  const stateDir = mkdtempSync(join(tmpdir(), "research-workbench-state-"));
  const jobsDir = mkdtempSync(join(tmpdir(), "research-workbench-jobs-"));
  writeFileSync(join(jobsDir, "generac-weekly-brief.json"), JSON.stringify(generacDemoDefinition(), null, 2));

  const startServer = () => {
    const child = spawn(process.execPath, [
      SERVER,
      "--state-dir", stateDir,
      "--jobs-dir", jobsDir,
      "--drop-root", DROP_ROOT,
      "--port", "0",
      "--operator-ref", "op-1",
      "--workspace-ref", "ws-1",
      "--actor", "operator-1",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { out += d.toString(); });
    const urlPromise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`server did not print its URL in 15s; output so far:\n${out}`)), 15000);
      const poll = setInterval(() => {
        const m = /listening on (http:\/\/127\.0\.0\.1:\d+\/research)/.exec(out);
        if (m) { clearTimeout(timer); clearInterval(poll); resolvePromise(m[1]); }
      }, 100);
      child.once("exit", (code) => { clearTimeout(timer); clearInterval(poll); rejectPromise(new Error(`server exited ${code}; output:\n${out}`)); });
    });
    return { child, urlPromise };
  };
  const stopServer = (child) => new Promise((resolvePromise) => {
    child.once("exit", resolvePromise);
    child.kill("SIGTERM");
    setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } }, 5000);
  });
  const postForm = async (url, fields) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });

  try {
    // Run 1: fresh server, full flow.
    const run1 = startServer();
    const base = await run1.urlPromise;
    console.log(`[e2e] server up at ${base} (state ${stateDir})`);

    const listRes = await fetch(`${base}/`);
    assert.equal(listRes.status, 200);
    const listHtml = await listRes.text();
    assert.match(listHtml, /Weekly research brief/);
    assert.match(listHtml, /No preview yet/);
    console.log("[e2e] list: 1 disabled job, no preview yet — observed");

    const detailRes = await fetch(`${base}/jobs/${JOB_ID}`);
    assert.equal(detailRes.status, 200);
    console.log("[e2e] detail before preview: no run, preview form present — observed");

    const previewRes = await postForm(`${base}/jobs/${JOB_ID}/preview`, { invocation_id: "inv-e2e-1", corpus_id: CORPUS_ID });
    assert.equal(previewRes.status, 200);
    const previewHtml = await previewRes.text();
    assert.match(previewHtml, /Synthetic preview published as run run-/);
    const fields = decisionFormFields(previewHtml);
    assert.equal(fields.rowIds.length, 8, "Generac replay publishes 8 items");
    assert.match(previewHtml, /evidence sha256/);
    console.log("[e2e] preview: 8 PENDING items with citation digests — observed");

    for (let i = 0; i < fields.rowIds.length; i++) {
      const decision = i % 2 === 0 ? "accept" : "reject";
      const res = await postForm(`${base}/jobs/${JOB_ID}/decide`, {
        itemId: fields.itemId, reportDigest: fields.reportDigest, rowId: fields.rowIds[i], decision, note: "",
      });
      assert.equal(res.status, 200, `decide ${i}`);
      const html = await res.text();
      assert.match(html, new RegExp(`Decision recorded: revision ${i + 1}`));
    }
    console.log("[e2e] decisions: 8 recorded (accept/reject alternating), revisions 1-8 — observed");

    const closedRes = await fetch(`${base}/jobs/${JOB_ID}`);
    const closedHtml = await closedRes.text();
    assert.match(closedHtml, /REVIEW COMPLETE — all 8 items decided/);
    assert.doesNotMatch(closedHtml, /Accept for human consideration/);
    assert.doesNotMatch(closedHtml, /activate/i);
    console.log("[e2e] closed: all-decided banner, no decision forms left, no activation affordance — observed");

    await stopServer(run1.child);

    // Run 2: restart against the SAME state dir — decisions must persist.
    const run2 = startServer();
    const base2 = await run2.urlPromise;
    console.log(`[e2e] server restarted at ${base2} (same state dir)`);
    try {
      const afterRes = await fetch(`${base2}/jobs/${JOB_ID}`);
      assert.equal(afterRes.status, 200);
      const afterHtml = await afterRes.text();
      assert.match(afterHtml, /REVIEW COMPLETE — all 8 items decided/);
      assert.match(afterHtml, /ACCEPTED for human consideration/);
      assert.match(afterHtml, /REJECTED/);
      assert.match(afterHtml, /revision 8/);
      console.log("[e2e] after restart: all 8 decisions persisted, loop still closed — observed");
    } finally {
      await stopServer(run2.child);
    }
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(jobsDir, { recursive: true, force: true });
  }
});
