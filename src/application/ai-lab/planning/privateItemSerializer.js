import { canonicalDigest, canonicalJson, sha256Hex } from "../rental-ops/canonical.js";
import { FIELD_MAPPING_VERSION } from "./fieldMappings.js";
import { EVALUATOR_VERSION } from "./schedulerAssessment.js";
import { CONTROLS_EVALUATOR_VERSION } from "./controlsEvidenceAssessment.js";
import { MANAGER_EVALUATOR_VERSION } from "./managerComposition.js";
import { JobRefusal } from "./jobContracts.js";

/** Per-agent item id prefix, title and evaluator version (P2b-2, P2b-3). */
export const AGENT_ITEM = Object.freeze({
  scheduler: Object.freeze({ prefix: "sch", title: "Scheduler planning review", evaluator_version: EVALUATOR_VERSION }),
  "project-controls": Object.freeze({ prefix: "ctl", title: "Project controls evidence review", evaluator_version: CONTROLS_EVALUATOR_VERSION }),
  "project-manager": Object.freeze({ prefix: "pm", title: "Project Manager plan-health review", evaluator_version: MANAGER_EVALUATOR_VERSION }),
});

export const PRIVATE_ITEM_SCHEMA = "planning-private-item@1";

/**
 * Serialize an evaluated planning report into a private Workbench
 * item.
 *
 * Item identity is a canonical tuple — agent / version / owner /
 * typed project scope / window / clock policy / snapshot digest /
 * report digest / engine + mapping versions — so an identical replay
 * produces the identical item (idempotent publish), and changed
 * content can never silently overwrite a prior item: a tuple that
 * matches on identity but not on report bytes is a determinism
 * violation, refused as REPUBLISH_CONFLICT by the store.
 *
 * The publication timestamp lives OUTSIDE the digested report, so
 * the report bytes are identical across fixed-clock replays while
 * the publication event is still recorded honestly.
 *
 * Row identity (P670-005A lesson, applied): the report's row ids
 * are digests over complete canonical tuples (see
 * schedulerAssessment.schedulerRowId), never raw concatenations —
 * so two distinct rows can never share one decision identity, and
 * the check below refuses a repeated id with different bytes
 * outright instead of deduplicating it away. The one tolerated
 * repeat is the same row (identical canonical bytes) presented by
 * two sections — intentionally shared identity for one finding
 * rendered twice, never two findings sharing an id.
 */
export function reportRowIds(report) {
  const ids = ["report"];
  const seen = new Map([["report", null]]);
  const pushRows = (section) => {
    if (section && Array.isArray(section.rows)) {
      for (const row of section.rows) {
        if (typeof row?.row_id !== "string") continue;
        const bytes = canonicalJson(row);
        if (seen.has(row.row_id)) {
          if (seen.get(row.row_id) !== bytes) {
            throw new JobRefusal("DUPLICATE_ROW_IDENTITY", `duplicate public row identity '${row.row_id}' — distinct rows share one decision identity; row identities must be collision-safe (digest over the full tuple), never deduplicated into one`);
          }
          continue;
        }
        seen.set(row.row_id, bytes);
        ids.push(row.row_id);
      }
    }
    // Component rows nest activity/edge rows: they carry their own
    // decision identities too.
    if (section && Array.isArray(section.rows)) {
      for (const row of section.rows) {
        for (const nested of [...(row.activities ?? []), ...(row.edges ?? [])]) {
          if (typeof nested?.row_id !== "string") continue;
          const bytes = canonicalJson(nested);
          if (seen.has(nested.row_id)) {
            if (seen.get(nested.row_id) !== bytes) {
              throw new JobRefusal("DUPLICATE_ROW_IDENTITY", `duplicate public row identity '${nested.row_id}' — distinct rows share one decision identity`);
            }
            continue;
          }
          seen.set(nested.row_id, bytes);
          ids.push(nested.row_id);
        }
      }
    }
  };
  // Fixed section order: the report's own section order is the
  // historical row order (scheduler: components, lookahead,
  // integrity, review_list; controls: packages, integrity,
  // checklist, questions); inventory carries counts, not rows.
  // The Object.values pass covers every section for both agents;
  // the fixed-order pass first pins the scheduler order, and the
  // seen-map makes the second pass a no-op for those rows.
  for (const name of ["components", "lookahead", "integrity", "review_list"]) {
    pushRows(report.sections?.[name]);
  }
  for (const section of Object.values(report.sections ?? {})) pushRows(section);
  return ids;
}

export const EVIDENCE_RETENTION_MS = 24 * 3600 * 1000;

export function serializePrivateItem({ report, snapshot, publishedAt }) {
  const reportDigest = canonicalDigest(report);
  const agentItem = AGENT_ITEM[report.agent];
  if (!agentItem) throw new Error(`serializePrivateItem: unknown agent '${String(report.agent)}'`);
  const scope = report.project_scope_ref ?? { type: "scheduling-project", id: "unknown" };
  const tuple = {
    agent: report.agent,
    job_version: 1,
    owner_ref: report.owner_ref,
    project_scope_type: scope.type,
    project_scope_id: scope.id,
    window: report.window.name,
    clock_policy: "explicit-as-of",
    snapshot_digest: snapshot.digest,
    report_digest: reportDigest,
    engine_version: agentItem.evaluator_version,
    mapping_version: FIELD_MAPPING_VERSION,
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
    kind: "planning-report",
    agent: report.agent,
    title: `${agentItem.title} — ${report.review_date}`,
    synthetic: true,
    created_from: {
      snapshot_request_id: snapshot.snapshot_request_id,
      snapshot_digest: snapshot.digest,
      source_system: snapshot.source_system,
    },
    report_digest: reportDigest,
    report,
    evidence_spans: evidenceSpans,
    evidence_retained_until: new Date(
      (Number.isNaN(Date.parse(snapshot.collection?.finished_at))
        ? Date.parse(publishedAt)
        : Date.parse(snapshot.collection.finished_at)) + EVIDENCE_RETENTION_MS,
    ).toISOString(),
    row_ids: reportRowIds(report),
    pinned: {
      mapping_version: FIELD_MAPPING_VERSION,
      evaluator_version: agentItem.evaluator_version,
    },
    published_at: publishedAt,
    execution_authorized: false,
  };
}
