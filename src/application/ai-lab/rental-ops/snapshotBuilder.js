import { canonicalDigest, canonicalJson } from "./canonical.js";
import { READ_TIMEOUT_MS } from "./budgets.js";
import {
  DATASETS, FIELD_MAPPING_VERSION, projectRow,
} from "./fieldMappings.js";
import { JobRefusal } from "./jobContracts.js";
import { assertAdapterShape } from "./readAdapter.js";

export const SNAPSHOT_SCHEMA_VERSION = "rental-ops-snapshot@1";
export const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

const REF_FIELD = Object.freeze({
  properties: "property_ref", units: "unit_ref", leases: "lease_ref",
  memberships: "lease_ref", charges: "charge_ref", schedules: "schedule_ref",
});

/** Civil date (YYYY-MM-DD) of an instant in America/Chicago — the Rental Manager's "today". */
export function chicagoCivilDate(isoInstant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(isoInstant));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function withReadTimeout(promise, dataset) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new JobRefusal("READ_TIMEOUT", dataset)), READ_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Collect an owner-scoped snapshot through the read adapter and admit
 * it under the invocation budget. Every page container and every row
 * is charged BEFORE inspection; cross-owner rows refuse the whole
 * snapshot (no cross-owner bytes are ever returned); partial pages,
 * page failures, mixed revisions and duplicate conflicts mark the
 * snapshot PARTIAL instead of silently becoming a zero total.
 *
 * `clock` is injected ({ nowIso() }) so fixed-clock runs are exact.
 */
export async function buildSnapshot({ request, adapter, budget, clock }) {
  assertAdapterShape(adapter);
  const startedAt = clock.nowIso();
  const records = {};
  const evidence = {};
  const datasetFacts = {};
  const conflicts = [];
  const collectionErrors = [];
  const revisions = new Set();
  let partial = false;

  for (const dataset of DATASETS) {
    const admitted = []; // { row, dropped } in arrival order; canonicalized below
    const byRef = new Map();
    let seenCount = 0;
    let cursor = null;
    let expected = null;
    let complete = false;
    let errored = false;
    const seenCursors = new Set();
    for (;;) {
      let page;
      try {
        page = await withReadTimeout(
          adapter.collect(dataset, { owner_ref: request.owner_ref, cursor }),
          dataset,
        );
      } catch (err) {
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
      if (typeof page.revision === "string") revisions.add(page.revision);
      if (typeof page.expected_total === "number") expected = page.expected_total;
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
        const ref = row[REF_FIELD[dataset]];
        if (typeof ref !== "string" || ref.length === 0) {
          partial = true;
          collectionErrors.push({ dataset, code: "MISSING_RECORD_REF" });
          continue;
        }
        if (dataset !== "memberships" && byRef.has(ref)) {
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
      if (page.next_cursor === null || page.next_cursor === undefined) { complete = !errored; break; }
      if (typeof page.next_cursor !== "string" || seenCursors.has(page.next_cursor)) {
        partial = true;
        collectionErrors.push({ dataset, code: "CURSOR_FAULT" });
        break;
      }
      seenCursors.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    // Canonical order: by record ref, then by canonical bytes — page
    // arrival order can never change the admitted snapshot's identity.
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
    if (dataset === "memberships") {
      // Membership evidence is existence-only: one aggregated span per
      // lease (occurrence count), never per-member records.
      for (const a of admitted) {
        const ref = a.row.lease_ref;
        if (!spans[ref]) {
          spans[ref] = {
            dataset, record_ref: ref, occurrences: 0,
            field_pointers: Object.keys(a.row).filter((k) => a.row[k] !== undefined),
            sha256: canonicalDigest(a.row),
            dropped_fields: [...a.dropped].sort(),
          };
        }
        spans[ref].occurrences += 1;
        spans[ref].dropped_fields = [...new Set([...spans[ref].dropped_fields, ...a.dropped])].sort();
      }
    } else {
      for (const a of admitted) {
        const ref = a.row[REF_FIELD[dataset]];
        spans[ref] = {
          dataset, record_ref: ref,
          field_pointers: Object.keys(a.row).filter((k) => a.row[k] !== undefined),
          sha256: canonicalDigest(a.row),
          dropped_fields: [...a.dropped].sort(),
        };
      }
    }
    evidence[dataset] = spans;
    const received = seenCount;
    if (expected !== null && expected !== received) { complete = false; partial = true; }
    if (errored) complete = false;
    datasetFacts[dataset] = {
      expected, received, complete,
      pages_complete: complete,
    };
  }

  if (revisions.size > 1) partial = true;
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
    portfolio_ref: request.portfolio_ref,
    source_system: adapter.source_system ?? "unknown",
    source_revision: revisions.size === 1 ? [...revisions][0] : null,
    collection: { started_at: startedAt, finished_at: finishedAt },
    as_of: request.as_of,
    as_of_date: chicagoCivilDate(request.as_of),
    as_of_timezone: "America/Chicago",
    mapping_version: FIELD_MAPPING_VERSION,
    datasets: datasetFacts,
    consistency: partial ? "PARTIAL" : "CONSISTENT",
    stale,
    conflicts,
    collection_errors: collectionErrors,
  };
  const digest = canonicalDigest({ envelope, records });
  return { ...envelope, digest, records, evidence };
}
