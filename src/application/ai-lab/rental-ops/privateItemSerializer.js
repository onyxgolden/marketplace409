import { canonicalDigest, canonicalJson, sha256Hex } from "./canonical.js";
import { FIELD_MAPPING_VERSION } from "./fieldMappings.js";
import { EVALUATOR_VERSION } from "./propertyManagerJob.js";
import { ESCALATION_POLICY_VERSION } from "./jobContracts.js";

export const PRIVATE_ITEM_SCHEMA = "rental-ops-private-item@1";

/**
 * Serialize an evaluated report into a private Workbench item.
 *
 * Item identity is a canonical tuple — agent / version / owner /
 * window / clock policy / snapshot digest / report digest — so an
 * identical replay produces the identical item (idempotent publish),
 * and changed content can never silently overwrite a prior item: a
 * tuple that matches on identity but not on report bytes is a
 * determinism violation, refused as REPUBLISH_CONFLICT by the store.
 * The reporting window and the clock policy are bound into the
 * identity: a report computed under a different window or clock
 * regime can never share an item id.
 *
 * The publication timestamp lives OUTSIDE the digested report, so the
 * report bytes are identical across fixed-clock replays while the
 * publication event is still recorded honestly.
 */
export function reportRowIds(report) {
  const ids = ["report"];
  for (const section of ["lease_expirations", "integrity"]) {
    for (const row of report.sections[section].rows) ids.push(row.row_id);
  }
  for (const row of report.sections.overdue_balances.rows) ids.push(row.row_id);
  return ids;
}

export const EVIDENCE_RETENTION_MS = 24 * 3600 * 1000;

export function serializePrivateItem({ report, snapshot, publishedAt }) {
  const reportDigest = canonicalDigest(report);
  const tuple = {
    agent: report.agent,
    job_version: 1,
    owner_ref: report.owner_ref,
    window: report.window.name,
    clock_policy: "explicit-as-of",
    snapshot_digest: snapshot.digest,
    report_digest: reportDigest,
  };
  const itemId = `pm-${sha256Hex(canonicalJson(tuple)).slice(0, 24)}`;
  const evidenceSpans = [];
  for (const dataset of Object.keys(snapshot.evidence).sort()) {
    for (const ref of Object.keys(snapshot.evidence[dataset]).sort()) {
      evidenceSpans.push(snapshot.evidence[dataset][ref]);
    }
  }
  return {
    schema_version: PRIVATE_ITEM_SCHEMA,
    item_id: itemId,
    kind: "rental-ops-report",
    agent: report.agent,
    title: `Property Manager daily exception review — ${report.as_of_date}`,
    synthetic: true,
    created_from: {
      snapshot_request_id: snapshot.snapshot_request_id,
      snapshot_digest: snapshot.digest,
      source_system: snapshot.source_system,
    },
    report_digest: reportDigest,
    report,
    evidence_spans: evidenceSpans,
    // Evidence expiry: raw snapshots are the 24h-retention class. Past
    // this instant the review surface must not present decisions as
    // evidence-backed (the renderer disables the controls and the
    // server refuses new decisions with EXPIRED_EVIDENCE).
    evidence_retained_until: new Date(
      (Number.isNaN(Date.parse(snapshot.collection?.finished_at))
        ? Date.parse(publishedAt)
        : Date.parse(snapshot.collection.finished_at)) + EVIDENCE_RETENTION_MS,
    ).toISOString(),
    row_ids: reportRowIds(report),
    pinned: {
      mapping_version: FIELD_MAPPING_VERSION,
      evaluator_version: EVALUATOR_VERSION,
      escalation_policy_version: ESCALATION_POLICY_VERSION,
    },
    published_at: publishedAt,
    execution_authorized: false,
  };
}
