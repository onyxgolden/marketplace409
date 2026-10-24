import { canonicalDigest, canonicalJson } from "../rental-ops/canonical.js";
import { READ_TIMEOUT_MS } from "../rental-ops/budgets.js";
import {
  PLANNING_DATASETS, FIELD_MAPPING_VERSION, projectRow, utcCivilDate,
} from "./fieldMappings.js";
import { JobRefusal } from "./jobContracts.js";
import { assertAdapterShape } from "./readProjection.js";

export const SNAPSHOT_SCHEMA_VERSION = "planning-snapshot@1";
export const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

const REF_FIELD = Object.freeze({
  schedule_projects: "project_ref",
  schedule_calendars: "calendar_ref",
  schedule_lanes: "lane_ref",
  schedule_blocks: "block_ref",
  schedule_dependencies: "dependency_ref",
  schedule_calendar_holidays: "holiday_ref",
  schedule_blackout_windows: "blackout_ref",
});

/** Datasets whose rows carry a project_ref that must equal the scope project. */
const PROJECT_SCOPED = new Set([
  "schedule_projects", "schedule_lanes", "schedule_blocks", "schedule_blackout_windows",
]);

function withReadTimeout(promise, dataset) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new JobRefusal("READ_TIMEOUT", dataset)), READ_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Race a unit of collection work against the invocation deadline's
 * abort signal. When the deadline fires, the work is abandoned (the
 * runner additionally closes the adapter) and the run refuses with
 * EXECUTION_TIMEOUT — collection never gets a fresh window.
 */
function raceDeadline(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new JobRefusal("EXECUTION_TIMEOUT", "the single invocation deadline was reached during snapshot collection"));
  }
  return Promise.race([promise, new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(
      new JobRefusal("EXECUTION_TIMEOUT", "the single invocation deadline was reached during snapshot collection"),
    ), { once: true });
  })]);
}

/**
 * Collect an owner- and scope-bound snapshot through the read
 * adapter and admit it under the invocation budget. Every page
 * container and every row is charged BEFORE inspection; cross-owner
 * or out-of-scope rows refuse the whole snapshot (no foreign bytes
 * are ever returned); partial pages, page failures, mixed revisions
 * and duplicate conflicts mark the snapshot PARTIAL instead of
 * silently becoming a zero total.
 *
 * Scope rules (defense in depth behind the adapter's own RLS-like
 * filtering — the adapter serves only in-scope rows, and this
 * builder refuses any leak):
 * - Every row's owner_ref must equal the request's owner_ref.
 * - For PROJECT_SCOPED datasets, a non-null project_ref must equal
 *   the scope project id. (schedule_projects rows ARE the scope
 *   project itself; a foreign project row is a leak.)
 * - For schedule_calendars, a non-null project_ref must equal the
 *   scope project id; a null project_ref (global/reusable calendar)
 *   is admitted ONLY when its calendar_ref is in the host-owned
 *   authorizedGlobalRefs set — an unauthorized global calendar is
 *   a scope leak, refused, never silently served as a fallback.
 * - schedule_dependencies carry no project_ref: they are scoped by
 *   endpoint membership at assessment time (ties touching the
 *   admitted project's blocks). A tie served with no admitted
 *   endpoint is flagged there, never used for math.
 * - schedule_calendar_holidays carry a calendar_ref, not a
 *   project_ref: a holiday for a calendar outside the admitted set
 *   is a scope leak and refuses (the adapter serves holidays only
 *   for calendars it serves; the builder re-checks once calendars
 *   are collected — collection order puts calendars first).
 *
 * `clock` is injected ({ nowIso() }) so fixed-clock runs are exact.
 * `signal` is the invocation deadline's AbortSignal: it is offered
 * to the adapter with every page request (a cooperative adapter may
 * abandon work early) and raced against every page read, so a
 * collection that reaches the deadline refuses EXECUTION_TIMEOUT
 * instead of consuming a second window downstream.
 */
export async function buildSnapshot({
  request, adapter, budget, clock, signal = undefined,
  datasets = PLANNING_DATASETS, authorizedGlobalRefs = new Set(),
}) {
  assertAdapterShape(adapter);
  const startedAt = clock.nowIso();
  const records = {};
  const evidence = {};
  const datasetFacts = {};
  const conflicts = [];
  const collectionErrors = [];
  const revisions = new Set();
  const datasetErrored = {};
  const coverageGaps = [];
  let allDatasetsAttested = true;
  let partial = false;
  const scopeProjectId = request.project_scope_ref?.id ?? null;
  const admittedCalendarRefs = new Set();

  for (const dataset of datasets) {
    const admitted = [];
    const byRef = new Map();
    let seenCount = 0;
    let cursor = null;
    let complete = false;
    let errored = false;
    const attestedRevisions = new Set();
    const attestedExpected = new Set();
    let terminalAttestedExpected = false;
    const seenCursors = new Set();
    for (;;) {
      if (signal?.aborted) {
        throw new JobRefusal("EXECUTION_TIMEOUT", "the single invocation deadline was reached during snapshot collection");
      }
      let page;
      try {
        page = await raceDeadline(withReadTimeout(
          adapter.collect(dataset, {
            owner_ref: request.owner_ref,
            project_scope: request.project_scope_ref,
            cursor, signal,
          }),
          dataset,
        ), signal);
      } catch (err) {
        if (err instanceof JobRefusal && err.code === "EXECUTION_TIMEOUT") throw err;
        errored = true;
        partial = true;
        collectionErrors.push({ dataset, code: err?.code ?? "ADAPTER_ERROR" });
        break;
      }
      budget.measureCandidate(page, `${dataset} page`);
      if (page === null || typeof page !== "object" || !Array.isArray(page.rows)) {
        errored = true;
        partial = true;
        collectionErrors.push({ dataset, code: "BAD_PAGE" });
        break;
      }
      if (typeof page.revision === "string") attestedRevisions.add(page.revision);
      if (typeof page.expected_total === "number") attestedExpected.add(page.expected_total);
      for (const raw of page.rows) {
        budget.measureCandidate(raw, `${dataset} row`);
        seenCount += 1;
        const { row, dropped } = projectRow(dataset, raw);
        if (row === null) {
          partial = true;
          collectionErrors.push({ dataset, code: "MALFORMED_ROW" });
          continue;
        }
        if (row.owner_ref !== request.owner_ref) {
          throw new JobRefusal("SCOPE_VIOLATION", `${dataset} row outside the requested owner scope`);
        }
        if (PROJECT_SCOPED.has(dataset)) {
          if (row.project_ref !== undefined && row.project_ref !== null && row.project_ref !== scopeProjectId) {
            throw new JobRefusal("SCOPE_VIOLATION", `${dataset} row for a different project scope`);
          }
        }
        if (dataset === "schedule_calendars") {
          if (row.project_ref !== undefined && row.project_ref !== null && row.project_ref !== scopeProjectId) {
            throw new JobRefusal("SCOPE_VIOLATION", "schedule_calendars row for a different project scope");
          }
          if ((row.project_ref === undefined || row.project_ref === null)
            && !authorizedGlobalRefs.has(row.calendar_ref)) {
            throw new JobRefusal("SCOPE_VIOLATION", `global calendar '${String(row.calendar_ref)}' is not in the host-authorized global set`);
          }
        }
        if (dataset === "schedule_calendar_holidays" && !admittedCalendarRefs.has(row.calendar_ref)) {
          throw new JobRefusal("SCOPE_VIOLATION", `holiday for calendar '${String(row.calendar_ref)}' outside the admitted calendar set`);
        }
        const ref = row[REF_FIELD[dataset]];
        if (typeof ref !== "string" || ref.length === 0) {
          partial = true;
          collectionErrors.push({ dataset, code: "MISSING_RECORD_REF" });
          continue;
        }
        if (byRef.has(ref)) {
          if (canonicalJson(byRef.get(ref)) !== canonicalJson(row)) {
            partial = true;
            conflicts.push({ dataset, record_ref: ref, code: "DUPLICATE_CONFLICT" });
          }
          continue;
        }
        byRef.set(ref, row);
        admitted.push({ row, dropped });
        budget.chargeEvidenceSpan();
      }
      if (page.next_cursor === null) {
        if (typeof page.expected_total === "number") terminalAttestedExpected = true;
        complete = !errored;
        break;
      }
      if (page.next_cursor === undefined) {
        errored = true;
        partial = true;
        collectionErrors.push({ dataset, code: "TERMINAL_UNATTESTED" });
        break;
      }
      if (typeof page.next_cursor !== "string" || seenCursors.has(page.next_cursor)) {
        errored = true;
        partial = true;
        collectionErrors.push({ dataset, code: "CURSOR_FAULT" });
        break;
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    admitted.sort((a, b) => {
      const ra = a.row[REF_FIELD[dataset]];
      const rb = b.row[REF_FIELD[dataset]];
      if (ra !== rb) return ra < rb ? -1 : 1;
      const ca = canonicalJson(a.row);
      const cb = canonicalJson(b.row);
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    });
    records[dataset] = admitted.map((a) => a.row);
    const spans = {};
    for (const a of admitted) {
      const ref = a.row[REF_FIELD[dataset]];
      spans[ref] = {
        dataset, record_ref: ref,
        field_pointers: Object.keys(a.row).filter((k) => a.row[k] !== undefined),
        sha256: canonicalDigest(a.row),
        dropped_fields: [...a.dropped].sort(),
      };
    }
    evidence[dataset] = spans;
    if (dataset === "schedule_calendars") {
      for (const a of admitted) admittedCalendarRefs.add(a.row.calendar_ref);
    }
    const received = seenCount;
    const expectedValues = [...attestedExpected];
    const expectedAgreed = expectedValues.length === 1 ? expectedValues[0] : null;
    if (!errored) {
      if (expectedValues.length === 0) {
        complete = false; partial = true;
        coverageGaps.push({ dataset, code: "COVERAGE_UNATTESTED" });
      } else {
        if (expectedValues.length > 1) {
          complete = false; partial = true;
          coverageGaps.push({ dataset, code: "EXPECTED_COUNT_CONFLICT", detail: `pages attest differing expected_total values: ${expectedValues.join(", ")}` });
        }
        if (!terminalAttestedExpected) {
          complete = false; partial = true;
          coverageGaps.push({ dataset, code: "EXPECTED_COUNT_UNATTESTED", detail: "the terminal page did not attest expected_total" });
        }
        if (expectedAgreed !== null && expectedAgreed !== received) {
          complete = false; partial = true;
        }
      }
      if (attestedRevisions.size !== 1) {
        complete = false; partial = true;
        allDatasetsAttested = false;
        coverageGaps.push({
          dataset,
          code: "REVISION_UNATTESTED",
          detail: attestedRevisions.size === 0
            ? "no source revision was attested for this dataset"
            : "this dataset's pages attest differing revisions",
        });
      } else {
        revisions.add([...attestedRevisions][0]);
      }
    }
    if (errored) { complete = false; allDatasetsAttested = false; }
    datasetErrored[dataset] = errored;
    datasetFacts[dataset] = {
      expected: expectedAgreed, received, complete,
      pages_complete: complete,
      revision: attestedRevisions.size === 1 ? [...attestedRevisions][0] : null,
    };
  }

  if (revisions.size !== 1) {
    partial = true;
    coverageGaps.push({
      dataset: "snapshot",
      code: "REVISION_UNATTESTED",
      detail: revisions.size === 0
        ? "no source revision was attested for this snapshot"
        : "source revisions differ across datasets; the snapshot cannot be attested as one coherent point in time",
    });
  }
  const finishedAt = clock.nowIso();
  const asOfMs = Date.parse(request.as_of);
  const finishedMs = Date.parse(finishedAt);
  if (finishedMs > asOfMs) {
    throw new JobRefusal("SNAPSHOT_FROM_FUTURE", "collection finished after the requested as_of instant");
  }
  const stale = asOfMs - finishedMs > FRESHNESS_WINDOW_MS;
  if (stale) partial = true;

  const envelope = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_request_id: request.snapshot_request_id,
    owner_ref: request.owner_ref,
    project_scope_ref: request.project_scope_ref,
    source_system: adapter.source_system ?? "unknown",
    source_revision: revisions.size === 1 && allDatasetsAttested ? [...revisions][0] : null,
    collection: { started_at: startedAt, finished_at: finishedAt },
    as_of: request.as_of,
    review_date: utcCivilDate(request.as_of),
    as_of_timezone: "UTC",
    mapping_version: FIELD_MAPPING_VERSION,
    datasets: datasetFacts,
    consistency: partial ? "PARTIAL" : "CONSISTENT",
    coverage_gaps: coverageGaps,
    stale,
    conflicts,
    collection_errors: collectionErrors,
  };
  const digest = canonicalDigest({ envelope, records });
  return { ...envelope, digest, records, evidence };
}
