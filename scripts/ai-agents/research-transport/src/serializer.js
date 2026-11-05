/**
 * serializer.js — map a validated Research preview onto a private
 * Workbench item (P1-B).
 *
 * The serializer is the transport's enforcement point: it never
 * trusts caller bytes. It re-validates the definition through the
 * P1-A contract, then requires the receipt to prove it belongs to
 * that definition (mode SYNTHETIC_PREVIEW, job_status DISABLED,
 * definition hash match, run id recomputed from hash + invocation,
 * job id/version match, item count match, every item PENDING, every
 * item key unique). Anything else refuses — a stale, forged, or
 * half-built preview can never reach the store.
 *
 * Item shape follows the P2a private-item pattern (rental-ops
 * privateItemSerializer): a canonical identity, synthetic flag,
 * report digest, row ids as the decision address space, pinned
 * versions, and execution_authorized: false, always. The store's
 * own idempotency then applies: the same run id + the same bytes
 * is a no-op; the same run id + different bytes is a
 * REPUBLISH_CONFLICT from the store, propagated unchanged.
 *
 * The item embeds the validated definition and the next due instant
 * from the definition's declarative recurrence rule (preview math
 * only — the rule is stored, never registered, armed, or executed).
 * The item embeds the full preview bundle as its report, so the
 * private store is the single source of truth for the run card;
 * no separate snapshot record is written by this slice.
 */

import { canonicalStringify, sha256Hex } from "./canonical.js";
import { CODES, refuse } from "./errors.js";
import { validateJobDefinition, DELIVERABLE_SCHEMA_VERSION } from "../../research-job-contract/src/jobDefinition.js";
import { definitionHash, deriveRunId } from "../../research-job-contract/src/identity.js";
import { nextDueAfter } from "../../research-job-contract/src/recurrence.js";

export const RESEARCH_ITEM_SCHEMA = "research-private-item@1";
export const TRANSPORT_VERSION = "research-transport@1";

const HEX64_RE = /^[0-9a-f]{64}$/;
const UTC_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Serialize one validated preview into its private-store item.
 *
 * @param {object} args
 * @param {object} args.receipt - JobRunReceiptV1 from P1-A buildPreview.
 * @param {object[]} args.items - WorkbenchItemV1 list from the same preview.
 * @param {object} args.definition - JobDefinitionV1 the preview was computed under.
 * @param {string} args.publishedAt - UTC instant stamped on the item (the
 *   receipt's created_at in the transport path, so a replayed publish
 *   with identical inputs is byte-identical and idempotent).
 */
export function serializeResearchItem({ receipt, items, definition, publishedAt }) {
  const def = validateJobDefinition(definition);
  if (!isPlainObject(receipt)) refuse(CODES.BAD_PREVIEW_INPUT, "receipt must be an object");
  if (receipt.mode !== "SYNTHETIC_PREVIEW") {
    refuse(CODES.BAD_PREVIEW_INPUT, `receipt.mode must be 'SYNTHETIC_PREVIEW', got '${String(receipt.mode)}'`);
  }
  if (receipt.job_status !== "DISABLED") {
    refuse(CODES.BAD_PREVIEW_INPUT, `receipt.job_status must be 'DISABLED', got '${String(receipt.job_status)}'`);
  }
  const defHash = definitionHash(def);
  if (receipt.definition_hash !== defHash) {
    refuse(CODES.STALE_PREVIEW, "receipt.definition_hash does not match the given definition");
  }
  if (receipt.job_id !== def.job_id) refuse(CODES.BAD_PREVIEW_INPUT, "receipt.job_id does not match the definition");
  if (receipt.job_version !== def.version) refuse(CODES.BAD_PREVIEW_INPUT, "receipt.job_version does not match the definition");
  if (typeof receipt.invocation_id !== "string" || receipt.invocation_id.length === 0) {
    refuse(CODES.BAD_PREVIEW_INPUT, "receipt.invocation_id must be a non-empty string");
  }
  if (receipt.run_id !== deriveRunId(defHash, receipt.invocation_id)) {
    refuse(CODES.BAD_PREVIEW_INPUT, "receipt.run_id does not derive from the definition hash and invocation id");
  }
  if (typeof receipt.fixture_set_hash !== "string" || !HEX64_RE.test(receipt.fixture_set_hash)) {
    refuse(CODES.BAD_PREVIEW_INPUT, "receipt.fixture_set_hash must be a 64-hex digest");
  }
  if (!Array.isArray(items)) refuse(CODES.BAD_PREVIEW_INPUT, "items must be an array");
  if (receipt.item_count !== items.length) {
    refuse(CODES.BAD_PREVIEW_INPUT, `receipt.item_count ${receipt.item_count} does not match items length ${items.length}`);
  }
  const seenKeys = new Set();
  for (const item of items) {
    if (!isPlainObject(item)) refuse(CODES.BAD_PREVIEW_INPUT, "each preview item must be an object");
    if (item.decision_status !== "PENDING") {
      refuse(CODES.BAD_PREVIEW_INPUT, `preview item '${String(item.item_key)}' is not PENDING`);
    }
    if (typeof item.item_key !== "string" || item.item_key.length === 0) {
      refuse(CODES.BAD_PREVIEW_INPUT, "each preview item must carry a non-empty item_key");
    }
    if (seenKeys.has(item.item_key)) {
      refuse(CODES.DUPLICATE_ITEM_KEY, `duplicate item_key '${item.item_key}' — one decision could not address two rows distinctly`);
    }
    seenKeys.add(item.item_key);
  }
  if (typeof publishedAt !== "string" || !UTC_INSTANT_RE.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) {
    refuse(CODES.BAD_PREVIEW_INPUT, "publishedAt must be an explicit UTC instant (Zulu)");
  }

  const bundle = { receipt, items };
  const reportDigest = sha256Hex(canonicalStringify(bundle));
  const rowIds = items.map((item) => item.item_key);
  return {
    schema_version: RESEARCH_ITEM_SCHEMA,
    item_id: receipt.run_id,
    kind: "research-preview",
    agent: "research",
    title: def.title,
    synthetic: true,
    created_from: {
      job_id: def.job_id,
      job_version: def.version,
      definition_hash: defHash,
      fixture_set_hash: receipt.fixture_set_hash,
      invocation_id: receipt.invocation_id,
      actor: receipt.actor,
    },
    job_definition: def,
    next_due: nextDueAfter(def, receipt.created_at),
    report_digest: reportDigest,
    report: bundle,
    evidence_spans: items.map((item) => ({ item_key: item.item_key, evidence_sha256: item.evidence_sha256 })),
    row_ids: rowIds,
    pinned: {
      transport_version: TRANSPORT_VERSION,
      deliverable_schema_version: DELIVERABLE_SCHEMA_VERSION,
      job_contract: "research-job-contract",
    },
    published_at: publishedAt,
    execution_authorized: false,
    job_status: "DISABLED",
    mode: "SYNTHETIC_PREVIEW",
  };
}
