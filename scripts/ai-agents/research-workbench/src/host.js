/**
 * host.js — the P1-C Research Workbench host.
 *
 * A pure request handler over the P1-B transport: no sockets, no
 * filesystem, no clock of its own (an injected clock stamps
 * decisions in tests; production passes the server clock). The
 * server entry (server.js) adapts node:http to this handler.
 *
 * Routes (all under basePath, default /research):
 * - GET  /                  disabled job list, with each job's latest run state
 * - GET  /jobs/:jobId       job detail + latest run card + evidence viewer
 * - POST /jobs/:jobId/preview  explicit manual synthetic preview
 * - POST /jobs/:jobId/decide   one accept/reject per preview item
 *
 * There are no other routes: no activation, no scheduler, no admin,
 * no public surface. The host binds localhost only in server.js.
 *
 * Identity rules (the P1-B contract, enforced here at the boundary):
 * - The decision actor is the server-configured identity, never a
 *   request field. A body "actor" is not in any allowlist and
 *   refuses. Host routes MUST pass the configured actor; a route
 *   that forwarded a request-supplied actor would break the gate.
 * - The preview invocation id is explicit: the detail page renders a
 *   fresh id in the preview form, and re-posting the same form
 *   replays idempotently (same invocation → same run id → the
 *   store no-ops). A new preview needs a freshly rendered form.
 * - Bodies are strictly allowlisted per route and size-capped; an
 *   unknown field, an oversized body, or an unknown content type
 *   refuses before any transport call.
 * - Every decision re-reads the stored item and its digest through
 *   the transport, so a decision on a refreshed preview refuses
 *   STALE_DIGEST instead of silently landing on the new run.
 */

import { randomBytes } from "node:crypto";
import { renderJobList, renderJobDetail, renderErrorPage, isJobId } from "./render.js";
import { CODES, refuse } from "./errors.js";

const MAX_BODY_BYTES = 16 * 1024;

const STATUS_BY_CODE = Object.freeze({
  NOT_FOUND: 404,
  UNKNOWN_ITEM: 404,
  FORBIDDEN: 403,
  PRINCIPAL_MISMATCH: 403,
  METHOD_NOT_ALLOWED: 405,
  BAD_REQUEST: 400,
  BAD_DECISION: 400,
  BAD_INVOCATION: 400,
  BAD_PREVIEW_INPUT: 400,
  BAD_JOB: 400,
  BAD_CORPUS: 400,
  MISSING_SOURCE_AUTHORIZATION: 400,
  EXCLUDED_CORPUS: 400,
  BUDGET_EXCEEDED: 400,
  UNKNOWN_ROW: 400,
  ITEM_MISMATCH: 400,
  DUPLICATE_ITEM_KEY: 400,
  STALE_PREVIEW: 409,
  STALE_DIGEST: 409,
  REPUBLISH_CONFLICT: 409,
  DECISION_CONFLICT: 409,
  STORE_REQUIRED: 503,
  STORE_UNAVAILABLE: 503,
  JOB_DEFINITIONS_UNAVAILABLE: 503,
  BAD_HOST_CONFIG: 500,
  INTERNAL: 500,
});

function statusFor(error) {
  if (error && typeof error.code === "string" && STATUS_BY_CODE[error.code] !== undefined) {
    return STATUS_BY_CODE[error.code];
  }
  return 500;
}

function errorDetail(error) {
  // Coded refusals carry a safe, non-disclosing detail. Uncoded
  // errors never leak a stack or internals into the page.
  if (error && typeof error.code === "string") return error.message ?? error.code;
  return "The workbench could not complete the request.";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBody(bodyText, contentType) {
  if (typeof bodyText !== "string" || bodyText.length === 0) return {};
  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    refuse(CODES.BAD_REQUEST, "request body exceeds the 16 KiB limit");
  }
  if (contentType === "application/json") {
    try {
      const parsed = JSON.parse(bodyText);
      if (!isPlainObject(parsed)) refuse(CODES.BAD_REQUEST, "JSON body must be an object");
      return parsed;
    } catch {
      refuse(CODES.BAD_REQUEST, "request body is not valid JSON");
    }
  }
  if (contentType === "application/x-www-form-urlencoded") {
    const out = {};
    for (const [key, value] of new URLSearchParams(bodyText)) out[key] = value;
    return out;
  }
  refuse(CODES.BAD_REQUEST, `unsupported content type '${contentType}'`);
  return {};
}

function checkFields(body, allowed, where) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) refuse(CODES.BAD_REQUEST, `unknown field '${key}' in ${where}`);
  }
}

function newInvocationId() {
  return `inv-${randomBytes(12).toString("hex")}`;
}

export function createResearchWorkbenchHost({
  transport, jobs, actor, corpora, basePath = "/research", clock,
} = {}) {
  if (transport === null || typeof transport !== "object"
    || typeof transport.publishPreview !== "function"
    || typeof transport.decide !== "function"
    || typeof transport.getItem !== "function"
    || typeof transport.listItems !== "function"
    || typeof transport.getDecisions !== "function"
    || typeof transport.closedLoop !== "function") {
    refuse(CODES.BAD_HOST_CONFIG, "a P1-B research transport is required");
  }
  if (!Array.isArray(jobs)) refuse(CODES.BAD_HOST_CONFIG, "jobs must be an array of validated definitions");
  if (typeof actor !== "string" || actor.length === 0 || actor.length > 128) {
    refuse(CODES.BAD_HOST_CONFIG, "actor must be the server-configured operator identity");
  }
  if (!isPlainObject(corpora)) refuse(CODES.BAD_HOST_CONFIG, "corpora must map corpus_id → fixture corpus");
  if (typeof basePath !== "string" || !basePath.startsWith("/")) {
    refuse(CODES.BAD_HOST_CONFIG, "basePath must start with '/'");
  }
  const base = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const nowIso = () => (typeof clock?.nowIso === "function" ? clock.nowIso() : new Date().toISOString());
  const jobById = new Map(jobs.map((job) => [job.job_id, job]));

  async function latestRun(jobId) {
    const rows = await transport.listItems();
    let best = null;
    for (const row of rows) {
      if (!isPlainObject(row) || typeof row.item_id !== "string") continue;
      const full = await transport.getItem(row.item_id);
      if (full === null || full.created_from?.job_id !== jobId) continue;
      if (best === null || String(full.published_at) > String(best.published_at)) best = full;
    }
    return best;
  }

  async function runView(item) {
    if (item === null) return null;
    const decisions = await transport.getDecisions(item.item_id);
    const closed = await transport.closedLoop(item.item_id);
    const decided = new Set((decisions?.revisions ?? []).map((r) => r.row_id));
    return {
      item,
      decisions,
      closed,
      decidedCount: item.row_ids.filter((rowId) => decided.has(rowId)).length,
      pendingCount: item.row_ids.filter((rowId) => !decided.has(rowId)).length,
    };
  }

  async function listPage() {
    const runsByJob = new Map();
    for (const job of jobs) {
      const run = await latestRun(job.job_id);
      runsByJob.set(job.job_id, run === null ? null : await runView(run));
    }
    return { status: 200, body: renderJobList({ jobs, runsByJob, basePath: base || "/" }) };
  }

  async function detailPage(jobId, receiptNote) {
    const job = jobById.get(jobId);
    if (job === undefined) refuse(CODES.NOT_FOUND, `no research job '${jobId}'`);
    const runItem = await latestRun(jobId);
    const view = await runView(runItem);
    return {
      status: 200,
      body: renderJobDetail({
        job,
        run: view?.item ?? null,
        decisions: view?.decisions ?? null,
        closed: view?.closed ?? null,
        invocationId: newInvocationId(),
        receiptNote: receiptNote ?? null,
        basePath: base || "/",
      }),
    };
  }

  async function preview(jobId, body) {
    checkFields(body, ["invocation_id", "corpus_id"], "preview");
    const job = jobById.get(jobId);
    if (job === undefined) refuse(CODES.NOT_FOUND, `no research job '${jobId}'`);
    const invocationId = body.invocation_id;
    if (typeof invocationId !== "string" || invocationId.length === 0) {
      refuse(CODES.BAD_REQUEST, "invocation_id is required: a preview is explicit, never implicit");
    }
    const corpusId = body.corpus_id;
    if (typeof corpusId !== "string" || corpusId.length === 0) {
      refuse(CODES.BAD_REQUEST, "corpus_id is required: the preview corpus is chosen explicitly");
    }
    const corpus = corpora[corpusId];
    if (corpus === undefined) refuse(CODES.BAD_REQUEST, `unknown synthetic corpus '${corpusId}'`);
    const { item, put } = await transport.publishPreview({
      definition: job, invocation_id: invocationId, actor, corpus, now: nowIso(),
    });
    const note = put.idempotent
      ? `Preview replayed — identical inputs, no second run created (run ${item.item_id}).`
      : `Synthetic preview published as run ${item.item_id} (${item.report?.items?.length ?? 0} items, all PENDING).`;
    return detailPage(jobId, note);
  }

  async function decide(jobId, body) {
    checkFields(body, ["itemId", "reportDigest", "rowId", "decision", "note", "decisionId"], "decision");
    const job = jobById.get(jobId);
    if (job === undefined) refuse(CODES.NOT_FOUND, `no research job '${jobId}'`);
    if (typeof body.itemId !== "string" || body.itemId.length === 0) {
      refuse(CODES.BAD_REQUEST, "itemId is required");
    }
    const decisionBody = {
      itemId: body.itemId,
      reportDigest: body.reportDigest,
      rowId: body.rowId,
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : "",
      ...(typeof body.decisionId === "string" && body.decisionId.length > 0 ? { decisionId: body.decisionId } : {}),
    };
    const result = await transport.decide({ itemId: body.itemId, body: decisionBody, actor, at: nowIso() });
    const revision = result.revision;
    const note = result.idempotent
      ? `Decision replayed — revision ${revision.revision} already recorded for this row (${revision.decision}).`
      : `Decision recorded: revision ${revision.revision} — ${revision.decision} on row ${revision.row_id}.`;
    return detailPage(jobId, note);
  }

  /**
   * Handle one request. `path` is the URL pathname (no query);
   * `bodyText` is the raw request body ("" when none).
   * Returns { status, contentType, body } — always an HTML page.
   */
  async function handleRequest({ method, path, bodyText = "", contentType = "" } = {}) {
    try {
      if (typeof path !== "string" || !(path === base || path.startsWith(`${base}/`))) {
        refuse(CODES.NOT_FOUND, "no such workbench route");
      }
      const rest = path === base ? "/" : path.slice(base.length);
      const segments = rest.split("/").filter((s) => s.length > 0);
      if (segments.length === 0) {
        if (method !== "GET") refuse(CODES.METHOD_NOT_ALLOWED, "the job list is read-only");
        return html(await listPage());
      }
      if (segments[0] !== "jobs" || segments.length > 3) {
        refuse(CODES.NOT_FOUND, "no such workbench route");
      }
      const jobId = decodeURIComponent(segments[1] ?? "");
      if (!isJobId(jobId)) refuse(CODES.NOT_FOUND, "no such research job");
      if (segments.length === 2) {
        if (method !== "GET") refuse(CODES.METHOD_NOT_ALLOWED, "the job page is read-only");
        return html(await detailPage(jobId, null));
      }
      if (segments[2] === "preview") {
        if (method !== "POST") refuse(CODES.METHOD_NOT_ALLOWED, "preview requires POST");
        const body = parseBody(bodyText, contentType.split(";")[0].trim());
        return html(await preview(jobId, body));
      }
      if (segments[2] === "decide") {
        if (method !== "POST") refuse(CODES.METHOD_NOT_ALLOWED, "decisions require POST");
        const body = parseBody(bodyText, contentType.split(";")[0].trim());
        return html(await decide(jobId, body));
      }
      refuse(CODES.NOT_FOUND, "no such workbench route");
      return null;
    } catch (e) {
      const status = statusFor(e);
      return {
        status,
        contentType: "text/html; charset=utf-8",
        body: renderErrorPage({ status, code: e?.code ?? "INTERNAL", detail: errorDetail(e) }),
      };
    }
  }

  function html(page) {
    return { status: page.status, contentType: "text/html; charset=utf-8", body: page.body };
  }

  return Object.freeze({ handleRequest, basePath: base || "/" });
}
