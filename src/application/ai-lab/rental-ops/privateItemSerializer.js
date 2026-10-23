import { canonicalDigest, canonicalJson, sha256Hex } from "./canonical.js";
import { FIELD_MAPPING_VERSION } from "./fieldMappings.js";
import { EVALUATOR_VERSION as PM_EVALUATOR_VERSION } from "./propertyManagerJob.js";
import { EVALUATOR_VERSION as MM_EVALUATOR_VERSION } from "./maintenanceManagerJob.js";
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
  // P2a-2: the Property Manager's historical row order is preserved
  // exactly (lease_expirations, integrity, overdue_balances); any
  // other row-bearing sections (the Maintenance Manager's backlog /
  // overdue / integrity) follow, deduplicated.
  const ids = ["report"];
  const seen = new Set();
  const pushRows = (section) => {
    if (section && Array.isArray(section.rows)) {
      for (const row of section.rows) {
        if (typeof row?.row_id === "string" && !seen.has(row.row_id)) {
          ids.push(row.row_id);
          seen.add(row.row_id);
        }
      }
    }
  };
  for (const name of ["lease_expirations", "integrity", "overdue_balances"]) {
    pushRows(report.sections?.[name]);
  }
  for (const section of Object.values(report.sections ?? {})) pushRows(section);
  return ids;
}

const AGENT_ITEM = {
  "property-manager": {
    prefix: "pm",
    title: (asOfDate) => `Property Manager daily exception review — ${asOfDate}`,
    evaluator_version: PM_EVALUATOR_VERSION,
  },
  "maintenance-manager": {
    prefix: "mm",
    title: (asOfDate) => `Maintenance Manager backlog review — ${asOfDate}`,
    evaluator_version: MM_EVALUATOR_VERSION,
  },
};

export const EVIDENCE_RETENTION_MS = 24 * 3600 * 1000;

export function serializePrivateItem({ report, snapshot, publishedAt }) {
  const reportDigest = canonicalDigest(report);
  // P2a-2: per-agent item identity. The agent is bound into the tuple
  // and the id prefix, so a Maintenance Manager report can never
  // collide with (or silently overwrite) a Property Manager item.
  const agentItem = AGENT_ITEM[report.agent];
  if (!agentItem) throw new Error(`serializePrivateItem: unknown agent '${String(report.agent)}'`);
  const tuple = {
    agent: report.agent,
    job_version: 1,
    owner_ref: report.owner_ref,
    window: report.window.name,
    clock_policy: "explicit-as-of",
    snapshot_digest: snapshot.digest,
    report_digest: reportDigest,
  };
  const itemId = `${agentItem.prefix}-${sha256Hex(canonicalJson(tuple)).slice(0, 24)}`;
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
    title: agentItem.title(report.as_of_date),
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
      evaluator_version: agentItem.evaluator_version,
      escalation_policy_version: ESCALATION_POLICY_VERSION,
    },
    published_at: publishedAt,
    execution_authorized: false,
  };
}
