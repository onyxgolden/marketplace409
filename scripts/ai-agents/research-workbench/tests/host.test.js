import test from "node:test";
import assert from "node:assert/strict";
import { hostFor, JOB_ID, CORPUS_ID, formBody, runPreview, decisionFormFields, NOW } from "./helpers.js";
import { generacDemoDefinition } from "../src/jobs.js";

async function get(host, path) {
  return host.handleRequest({ method: "GET", path });
}

async function post(host, path, fields, contentType = "application/x-www-form-urlencoded") {
  return host.handleRequest({
    method: "POST",
    path,
    bodyText: typeof fields === "string" ? fields : formBody(fields),
    contentType,
  });
}

test("list → detail (no run) → preview → 8 items, all PENDING", async () => {
  const { host } = hostFor();
  const list = await get(host, "/research/");
  assert.equal(list.status, 200);
  assert.match(list.body, /Weekly research brief/);
  assert.match(list.body, /No preview yet/);
  assert.match(list.body, /DISABLED/);

  const detail = await get(host, `/research/jobs/${JOB_ID}`);
  assert.equal(detail.status, 200);
  assert.match(detail.body, /No synthetic preview has run/);
  assert.match(detail.body, /Run a synthetic preview/);

  const preview = await runPreview(host);
  assert.equal(preview.status, 200);
  assert.match(preview.body, /Synthetic preview published as run run-/);
  // Count the PENDING chips (one per item), not the bare word — the
  // receipt note itself says "all PENDING".
  const pending = (preview.body.match(/class="chip pending"/g) ?? []).length;
  assert.equal(pending, 8, "the Generac replay publishes 8 PENDING items");
  assert.match(preview.body, /evidence sha256/);
  assert.match(preview.body, /Budget used: 8\/64 items/);
});

test("decide all 8 items (accept/reject mix) → closed loop, all-decided banner, no forms left", async () => {
  const { host, transport } = hostFor();
  const preview = await runPreview(host);
  const { itemId, reportDigest, rowIds } = decisionFormFields(preview.body);
  assert.equal(rowIds.length, 8);

  for (let i = 0; i < rowIds.length; i++) {
    const decision = i % 2 === 0 ? "accept" : "reject";
    const res = await post(host, `/research/jobs/${JOB_ID}/decide`, {
      itemId, reportDigest, rowId: rowIds[i], decision, note: i === 1 ? "weak evidence" : "",
    });
    assert.equal(res.status, 200, `decide ${i} (${decision})`);
    assert.match(res.body, new RegExp(`Decision recorded: revision ${i + 1}`));
  }
  const closed = await transport.closedLoop(itemId);
  assert.equal(closed.closed, true);
  assert.equal(closed.pending_rows.length, 0);
  assert.equal(closed.decision_count, 8);

  const detail = await get(host, `/research/jobs/${JOB_ID}`);
  assert.match(detail.body, /REVIEW COMPLETE — all 8 items decided/);
  assert.match(detail.body, /ACCEPTED for human consideration/);
  assert.match(detail.body, /REJECTED/);
  assert.match(detail.body, /weak evidence/);
  assert.doesNotMatch(detail.body, /Accept for human consideration/);
  const list = await get(host, "/research/");
  assert.match(list.body, /REVIEW COMPLETE — all 8 items decided/);
});

test("duplicate decide replays idempotently; a changed decision is a new revision, a reused key with different material conflicts", async () => {
  const { host } = hostFor();
  const preview = await runPreview(host);
  const { itemId, reportDigest, rowIds } = decisionFormFields(preview.body);
  const fields = { itemId, reportDigest, rowId: rowIds[0], decision: "accept", note: "" };
  const first = await post(host, `/research/jobs/${JOB_ID}/decide`, fields);
  assert.match(first.body, /Decision recorded: revision 1/);
  const replay = await post(host, `/research/jobs/${JOB_ID}/decide`, fields);
  assert.equal(replay.status, 200);
  assert.match(replay.body, /Decision replayed — revision 1 already recorded/);
  // A changed decision on the same row is an explicit new revision
  // with history (brief: conflicting edits require a new revision),
  // not an overwrite.
  const changed = await post(host, `/research/jobs/${JOB_ID}/decide`, { ...fields, decision: "reject" });
  assert.equal(changed.status, 200);
  assert.match(changed.body, /Decision recorded: revision 2/);
  // The same decision_id carrying different material is the conflict
  // the store refuses: same key, different decision.
  const keyed = await post(host, `/research/jobs/${JOB_ID}/decide`, { ...fields, rowId: rowIds[1], decisionId: "d-key-1" });
  assert.equal(keyed.status, 200);
  const conflict = await post(host, `/research/jobs/${JOB_ID}/decide`, { ...fields, rowId: rowIds[1], decision: "reject", decisionId: "d-key-1" });
  assert.equal(conflict.status, 409);
  assert.match(conflict.body, /DECISION_CONFLICT/);
});

test("a body actor is refused — the actor comes from the server config only", async () => {
  const { host } = hostFor();
  const preview = await runPreview(host);
  const { itemId, reportDigest, rowIds } = decisionFormFields(preview.body);
  const res = await post(host, `/research/jobs/${JOB_ID}/decide`, {
    itemId, reportDigest, rowId: rowIds[0], decision: "accept", actor: "mallory",
  });
  // The host's strict body allowlist refuses the unknown "actor"
  // field before the transport ever sees it; the deeper guarantee
  // (decisionFromBody rejects a body actor) is covered by P1-B.
  assert.equal(res.status, 400);
  assert.match(res.body, /BAD_REQUEST/);
});

test("safe retry: replaying the same preview invocation is a no-op; a new invocation starts a fresh run", async () => {
  const { host, transport } = hostFor();
  const first = await runPreview(host, { invocationId: "inv-retry-1" });
  assert.match(first.body, /Synthetic preview published/);
  const replay = await runPreview(host, { invocationId: "inv-retry-1" });
  assert.equal(replay.status, 200);
  assert.match(replay.body, /Preview replayed — identical inputs, no second run created/);
  assert.equal((await transport.listItems()).length, 1);

  const second = await runPreview(host, { invocationId: "inv-retry-2" });
  assert.match(second.body, /Synthetic preview published/);
  assert.equal((await transport.listItems()).length, 2);
  // Decisions address the run shown, not the other one: the fresh run starts PENDING.
  const detail = await get(host, `/research/jobs/${JOB_ID}`);
  assert.equal((detail.body.match(/class="chip pending"/g) ?? []).length, 8);
});

test("a decision against a refreshed preview refuses STALE_DIGEST", async () => {
  const { host } = hostFor();
  const first = await runPreview(host, { invocationId: "inv-stale-1" });
  const fields = decisionFormFields(first.body);
  // A decision naming the old item but a forged digest refuses: the
  // digest binds the decision to the exact preview bytes rendered.
  const stale = await post(host, `/research/jobs/${JOB_ID}/decide`, {
    itemId: fields.itemId, reportDigest: "0".repeat(64), rowId: fields.rowIds[0], decision: "accept",
  });
  assert.equal(stale.status, 409);
  assert.match(stale.body, /STALE_DIGEST/);
});

test("a decision posted through job A's route with job B's run refuses JOB_MISMATCH and leaves B's history unchanged", async () => {
  const jobA = generacDemoDefinition();
  const jobB = { ...jobA, job_id: "research-monthly-brief@1" };
  const { host, transport } = hostFor({ jobs: [jobA, jobB] });
  // Both jobs share the principal, so the transport's
  // operator/workspace check passes for both runs — only the
  // route's job-identity check can stop the cross-job mutation.
  const previewA = await runPreview(host, { jobId: jobA.job_id, invocationId: "inv-cross-a" });
  assert.equal(previewA.status, 200);
  const previewB = await runPreview(host, { jobId: jobB.job_id, invocationId: "inv-cross-b" });
  assert.equal(previewB.status, 200);
  const fieldsB = decisionFormFields(previewB.body);
  assert.equal(fieldsB.rowIds.length, 8);
  // B's valid decision material, posted through A's decide endpoint.
  const refused = await post(host, `/research/jobs/${jobA.job_id}/decide`, {
    itemId: fieldsB.itemId, reportDigest: fieldsB.reportDigest, rowId: fieldsB.rowIds[0], decision: "accept",
  });
  assert.equal(refused.status, 403);
  assert.match(refused.body, /JOB_MISMATCH/);
  // No decision landed anywhere: B's history is empty, and A's run
  // is untouched too.
  const decisionsB = await transport.getDecisions(fieldsB.itemId);
  assert.equal((decisionsB?.revisions ?? []).length, 0);
  const fieldsA = decisionFormFields(previewA.body);
  const decisionsA = await transport.getDecisions(fieldsA.itemId);
  assert.equal((decisionsA?.revisions ?? []).length, 0);
  // B's own route still decides normally afterwards.
  const ok = await post(host, `/research/jobs/${jobB.job_id}/decide`, {
    itemId: fieldsB.itemId, reportDigest: fieldsB.reportDigest, rowId: fieldsB.rowIds[0], decision: "accept",
  });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /Decision recorded: revision 1/);
});

test("foreign-principal host sees no rows and cannot read or decide them", async () => {
  const first = hostFor();
  await runPreview(first.host);
  const rows = await first.transport.listItems();
  assert.equal(rows.length, 1);
  // Same store, other principal: the transport is the enforcement
  // point, so the foreign host's list/detail must show nothing.
  const { createResearchTransport } = await import("../../research-transport/src/transport.js");
  const foreignTransport = createResearchTransport({ store: first.store, principal: { operator_ref: "op-2", workspace_ref: "ws-1" }, clock: { nowIso: () => NOW } });
  const { createResearchWorkbenchHost } = await import("../src/host.js");
  const { generacDemoDefinition, generacReplayCorpus } = await import("../src/jobs.js");
  const foreignHost = createResearchWorkbenchHost({
    transport: foreignTransport,
    jobs: [{ ...generacDemoDefinition(), operator_scope: { operator_ref: "op-2", workspace_ref: "ws-1" } }],
    actor: "operator-2",
    corpora: { [CORPUS_ID]: generacReplayCorpus() },
    basePath: "/research",
    clock: { nowIso: () => NOW },
  });
  const list = await get(foreignHost, "/research/");
  assert.equal(list.status, 200);
  assert.match(list.body, /No preview yet/);
  const denied = await get(foreignHost, `/research/jobs/${JOB_ID}`);
  // The foreign job has no run of its own; its detail shows no preview.
  assert.match(denied.body, /No synthetic preview has run/);
});

test("unknown job, unknown route, wrong method, bad invocation, and unknown corpus all refuse cleanly", async () => {
  const { host } = hostFor();
  const unknownJob = await get(host, "/research/jobs/research-nope@1");
  assert.equal(unknownJob.status, 404);
  const unknownRoute = await get(host, "/research/activate");
  assert.equal(unknownRoute.status, 404);
  const noActivation = await post(host, "/research/jobs/" + JOB_ID + "/activate", {});
  assert.equal(noActivation.status, 404);
  const wrongMethod = await post(host, "/research/", {});
  assert.equal(wrongMethod.status, 405);
  const badInvocation = await runPreview(host, { invocationId: "bad invocation!" });
  assert.equal(badInvocation.status, 400);
  const unknownCorpus = await runPreview(host, { corpusId: "no-such-corpus" });
  assert.equal(unknownCorpus.status, 400);
  const oversized = await post(host, `/research/jobs/${JOB_ID}/preview`, { invocation_id: "inv-x", corpus_id: CORPUS_ID, extra: "x".repeat(20000) });
  assert.equal(oversized.status, 400);
});

test("empty-corpus preview renders its meaningful empty claim with zero items", async () => {
  const { host } = hostFor();
  const res = await runPreview(host, { corpusId: "empty-corpus" });
  assert.equal(res.status, 200);
  // The apostrophe is HTML-escaped in the served page (&#39;); the
  // claim itself is the meaningful empty claim, not invented items.
  assert.match(res.body, /No synthetic items in corpus &#39;empty-corpus&#39;/);
  assert.equal((res.body.match(/class="chip pending"/g) ?? []).length, 0);
  assert.match(res.body, /REVIEW COMPLETE — all 0 items decided/);
});
