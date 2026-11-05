/**
 * helpers.js — shared fixtures for the P1-C suites.
 *
 * The host under test is wired exactly like the real server: the
 * P1-B transport over an in-memory double of the private store
 * contract (P1-B tests/storeDouble.js), the demo Generac definition
 * from fixtures/, and the P1-A synthetic corpora.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createResearchTransport } from "../../research-transport/src/transport.js";
import { createStoreDouble } from "../../research-transport/tests/storeDouble.js";
import { createResearchWorkbenchHost } from "../src/host.js";
import { generacDemoDefinition, generacReplayCorpus, loadFixtureCorpus } from "../src/jobs.js";

export const PRINCIPAL = Object.freeze({ operator_ref: "op-1", workspace_ref: "ws-1" });
export const ACTOR = "operator-1";
export const NOW = "2026-11-05T12:00:00Z";

export function loadCorpora() {
  return {
    "generac-7209-synthetic-replay": generacReplayCorpus(),
    "small-corpus": loadFixtureCorpus("small-corpus.json"),
    "empty-corpus": loadFixtureCorpus("empty-corpus.json"),
  };
}

/** A host wired to a fresh in-memory store; returns { host, transport, store }. */
export function hostFor({ jobs, principal = PRINCIPAL, actor = ACTOR, corpora = loadCorpora() } = {}) {
  const store = createStoreDouble();
  const transport = createResearchTransport({ store, principal, clock: { nowIso: () => NOW } });
  const host = createResearchWorkbenchHost({
    transport,
    jobs: jobs ?? [generacDemoDefinition()],
    actor,
    corpora,
    basePath: "/research",
    clock: { nowIso: () => NOW },
  });
  return { host, transport, store };
}

export const JOB_ID = "research-weekly-brief@1";
export const CORPUS_ID = "generac-7209-synthetic-replay";

export function formBody(fields) {
  return new URLSearchParams(fields).toString();
}

/** Run one synthetic preview through the host; returns the host response. */
export async function runPreview(host, { jobId = JOB_ID, invocationId = "inv-e2e-1", corpusId = CORPUS_ID } = {}) {
  return host.handleRequest({
    method: "POST",
    path: `/research/jobs/${jobId}/preview`,
    bodyText: formBody({ invocation_id: invocationId, corpus_id: corpusId }),
    contentType: "application/x-www-form-urlencoded",
  });
}

/** Read the detail page and pull the item's report digest + row ids out of its hidden fields. */
export function decisionFormFields(detailHtml) {
  const itemId = /name="itemId" value="([^"]+)"/.exec(detailHtml)?.[1];
  const reportDigest = /name="reportDigest" value="([^"]+)"/.exec(detailHtml)?.[1];
  const rowIds = [...detailHtml.matchAll(/name="rowId" value="([^"]+)"/g)].map((m) => m[1]);
  return { itemId, reportDigest, rowIds };
}
