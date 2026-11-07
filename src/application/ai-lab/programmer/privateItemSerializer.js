/**
 * privateItemSerializer.js — serialize a validated dry-run proposal
 * into a private Workbench item.
 *
 * Item identity is a canonical tuple — agent / version / owner /
 * task / base SHA / candidate tree digest / patch digest / proposal
 * digest — so an identical replay produces the identical item
 * (idempotent publish), and changed content can never silently
 * overwrite a prior item: a tuple that matches on identity but not
 * on proposal bytes is a determinism violation, refused as
 * REPUBLISH_CONFLICT (see checkRepublish).
 *
 * The publication timestamp lives OUTSIDE the digested proposal, so
 * the proposal bytes are identical across fixed-clock replays while
 * the publication event is still recorded honestly.
 *
 * Owner scope (synthetic slice): the item's owner is the operator
 * who requested the dry run (proposal.operator.operator_ref). There
 * is no live portfolio here; a future activation slice must bind a
 * real owner/portfolio registration instead of reusing this.
 */
import { canonicalDigest, canonicalJson, sha256Hex } from "../rental-ops/canonical.js";
import { JobRefusal, POLICY_VERSION, PRIVATE_ITEM_SCHEMA, PROTOTYPE_VERSION } from "./jobContracts.js";
import { validateProposal } from "./proposalSchema.js";
import { mapReceiptToVerification, RECEIPT_MAPPING_VERSION } from "./receiptMapping.js";

// A Map, not a plain object (the #668 F4.2 pattern family): a
// prototype-named agent string ("constructor", "toString",
// "__proto__") must miss the registry and fail closed through the
// unknown-agent refusal, never resolve through the prototype chain.
const AGENT_ITEM = new Map([
  [
    "programmer",
    {
      prefix: "prog",
      title: (jobId) => `Programmer dry-run proposal — ${jobId}`,
    },
  ],
]);

export const EVIDENCE_RETENTION_MS = 24 * 3600 * 1000;

/**
 * Evidence row ids for decision binding: the proposal itself, one
 * row per planned file, and one row per P3 suite in the attached
 * receipt. Row ids are record-id safe (letters/digits/:/_/- only —
 * the Workbench RECORD_ID_RE); a file path reaches the row id only
 * as a digest fragment, never raw.
 */
export function proposalRowIds(proposal) {
  const ids = ["proposal"];
  const seen = new Map([["proposal", null]]);
  const push = (rowId, row) => {
    const bytes = canonicalJson(row);
    if (seen.has(rowId)) {
      if (seen.get(rowId) !== bytes) {
        throw new JobRefusal(
          "DUPLICATE_ROW_IDENTITY",
          `duplicate public row identity '${rowId}' — distinct rows share one decision identity; row identities must be collision-safe, never deduplicated into one`,
        );
      }
      return;
    }
    seen.set(rowId, bytes);
    ids.push(rowId);
  };
  for (const f of proposal.plan.files) {
    push(`evidence-file-${sha256Hex(f.path).slice(0, 12)}`, { kind: "file", path: f.path, operation: f.operation });
  }
  const receipt = proposal.verification?.receipt;
  if (receipt && Array.isArray(receipt.suites)) {
    for (const s of receipt.suites) {
      push(`evidence-suite-${s.id}`, { kind: "suite", suite: s.id, status: s.status });
    }
  }
  return ids;
}

export function serializePrivateItem({ proposal, publishedAt }) {
  const valid = validateProposal(proposal);
  const agentItem = AGENT_ITEM.get(valid.agent);
  if (!agentItem) throw new JobRefusal("UNKNOWN_AGENT", `unknown agent '${String(valid.agent)}'`);
  const proposalDigest = canonicalDigest(valid);
  const verification = mapReceiptToVerification({ proposal: valid, receipt: valid.verification.receipt });
  const ownerRef = valid.operator.operator_ref;
  const tuple = {
    agent: valid.agent,
    job_version: 1,
    owner_ref: ownerRef,
    task_id: valid.task.task_id,
    base_sha: valid.source.base_sha,
    candidate_tree_digest: valid.plan.candidate_tree_digest,
    patch_sha256: valid.plan.patch_sha256,
    proposal_digest: proposalDigest,
  };
  const itemId = `${agentItem.prefix}-${sha256Hex(canonicalJson(tuple)).slice(0, 24)}`;
  const evidenceSpans = [];
  for (const f of valid.plan.files) {
    evidenceSpans.push({ row_id: `evidence-file-${sha256Hex(f.path).slice(0, 12)}`, kind: "file", path: f.path, operation: f.operation, added_lines: f.added_lines, removed_lines: f.removed_lines });
  }
  const receipt = valid.verification.receipt;
  if (receipt && Array.isArray(receipt.suites)) {
    for (const s of receipt.suites) {
      evidenceSpans.push({
        row_id: `evidence-suite-${s.id}`,
        kind: "suite",
        suite: s.id,
        status: s.status,
        reason_code: s.reason_code ?? null,
        test_counts: s.test_counts ?? null,
      });
    }
  }
  const item = {
    schema_version: PRIVATE_ITEM_SCHEMA,
    item_id: itemId,
    kind: "programmer-dry-run-proposal",
    agent: valid.agent,
    title: agentItem.title(valid.job_id),
    synthetic: true,
    owner_ref: ownerRef,
    created_from: {
      proposal_job_id: valid.job_id,
      source_repo: valid.source.repo,
      base_sha: valid.source.base_sha,
      observed_head: valid.source.observed_head,
    },
    proposal_digest: proposalDigest,
    proposal: valid,
    verification,
    evidence_spans: evidenceSpans,
    evidence_retained_until: new Date(Date.parse(publishedAt) + EVIDENCE_RETENTION_MS).toISOString(),
    row_ids: proposalRowIds(valid),
    pinned: {
      policy_version: POLICY_VERSION,
      prototype_version: PROTOTYPE_VERSION,
      receipt_mapping_version: RECEIPT_MAPPING_VERSION,
      proposal_schema_version: valid.schema_version,
    },
    published_at: publishedAt,
    execution_authorized: false,
  };
  return Object.freeze(item);
}

/**
 * Republish guard for the (future) private store: an item id that
 * already exists with a different proposal digest is a determinism
 * violation, never a silent overwrite.
 */
export function checkRepublish(item, existingItem) {
  if (!existingItem) return true;
  if (existingItem.item_id !== item.item_id) return true;
  if (existingItem.proposal_digest !== item.proposal_digest) {
    throw new JobRefusal(
      "REPUBLISH_CONFLICT",
      `item '${item.item_id}' already exists with a different proposal digest — changed content cannot overwrite a prior item`,
    );
  }
  return true;
}
