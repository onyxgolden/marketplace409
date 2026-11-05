/**
 * transport.js — the P1-B Research transport adapter.
 *
 * Moves a validated Research job definition + synthetic preview into
 * the existing private Workbench store, and moves operator decisions
 * back through the store's append-only decision chain. It is an
 * adapter, not a service:
 *
 * - The store is an injected capability (the host harness passes the
 *   opened private store). No store → refuse closed. There is no
 *   fallback to Git, to a public path, or to any second store, and
 *   this module touches no filesystem itself.
 * - The host principal is injected (operator_ref + workspace_ref).
 *   A definition whose operator scope does not match the principal
 *   refuses — cross-workspace and cross-operator publishes are
 *   denied before any preview is built.
 * - The preview path is P1-A buildPreview, unchanged: validated
 *   definition + synthetic fixture corpus → receipt + items. The
 *   adapter adds no live source, no network, and no execution.
 * - Recurrence is stored as a declarative rule on the item
 *   (next_due is preview math from the receipt instant). Nothing
 *   here registers, arms, polls, or executes a scheduler: no
 *   timers, no cron, no queue, no background run of any kind.
 * - Activation is not granted by this adapter, by a publish, or by
 *   a decision: every item carries job_status DISABLED,
 *   mode SYNTHETIC_PREVIEW, and execution_authorized: false, and
 *   an ACCEPT decision means "accepted for human consideration"
 *   only. Activation remains a distinct Jason-only decision.
 * - Store errors propagate unchanged (REPUBLISH_CONFLICT,
 *   DECISION_CONFLICT, STALE_DIGEST from the store): an idempotent
 *   retry replays identical inputs and re-reads the stored item;
 *   a changed retry conflicts rather than overwriting.
 */

import { buildPreview } from "../../research-job-contract/src/preview.js";
import { validateJobDefinition } from "../../research-job-contract/src/jobDefinition.js";
import { serializeResearchItem } from "./serializer.js";
import { decisionFromBody, validateResearchDecision } from "./decisionValidator.js";
import { CODES, refuse } from "./errors.js";

const STORE_METHODS = Object.freeze(["putItem", "getItem", "listItems", "appendDecision", "getDecisions"]);

export function assertStoreShape(store) {
  if (store === null || typeof store !== "object") {
    refuse(CODES.STORE_REQUIRED, "a private store capability is required; refusing to fall back to any Git or public path");
  }
  for (const method of STORE_METHODS) {
    if (typeof store[method] !== "function") {
      refuse(CODES.STORE_REQUIRED, `store must expose ${method}()`);
    }
  }
  return store;
}

function assertPrincipal(principal) {
  if (principal === null || typeof principal !== "object" || Array.isArray(principal)
    || typeof principal.operator_ref !== "string" || principal.operator_ref.length === 0
    || typeof principal.workspace_ref !== "string" || principal.workspace_ref.length === 0) {
    refuse(CODES.BAD_HOST_CONFIG, "host principal must carry non-empty operator_ref and workspace_ref");
  }
  return principal;
}

/**
 * Create the transport bound to one host principal and one private
 * store. `clock.nowIso()` (when supplied) stamps decision times in
 * tests; production callers pass the server clock.
 */
export function createResearchTransport({ store, principal, clock } = {}) {
  assertStoreShape(store);
  assertPrincipal(principal);
  const nowIso = () => (typeof clock?.nowIso === "function" ? clock.nowIso() : new Date().toISOString());

  return {
    /**
     * Build a synthetic preview and publish it as one private
     * Workbench item. The published_at stamp is the receipt's own
     * created_at, so a replayed publish with identical inputs is
     * byte-identical and idempotent in the store. Returns
     * { item, put, receipt } where put is the store's publish
     * receipt ({ written, idempotent }).
     */
    async publishPreview({ definition, invocation_id, actor, corpus, now }) {
      const def = validateJobDefinition(definition);
      if (def.operator_scope.operator_ref !== principal.operator_ref
        || def.operator_scope.workspace_ref !== principal.workspace_ref) {
        refuse(CODES.PRINCIPAL_MISMATCH, "definition operator_scope does not match the host-registered principal");
      }
      const { receipt, items } = buildPreview({ definition: def, invocation_id, actor, corpus, now });
      const item = serializeResearchItem({ receipt, items, definition: def, publishedAt: receipt.created_at });
      const put = await store.putItem(item);
      return { item, put, receipt };
    },

    /**
     * File one operator decision against a stored item. The actor
     * is the server-derived session identity passed by the caller —
     * never a body field. Returns the store's append receipt
     * ({ revision, idempotent, record }).
     */
    async decide({ itemId, body, actor, at }) {
      const stored = await store.getItem(itemId);
      if (stored === null) refuse(CODES.UNKNOWN_ITEM, `no stored item '${String(itemId)}'`);
      const decision = decisionFromBody(stored, body, at ?? nowIso(), actor);
      return store.appendDecision(stored, decision, validateResearchDecision);
    },

    /** Read helpers for the P1-C surface (delegates; the store owns the bytes). */
    async getItem(itemId) {
      return store.getItem(itemId);
    },
    async listItems() {
      return store.listItems();
    },
    async getDecisions(itemId) {
      return store.getDecisions(itemId);
    },

    /**
     * The loop-closure check: CLOSED iff every row of the item has
     * at least one decision revision. A closed loop is review
     * completion only — never activation, execution, or dispatch.
     */
    async closedLoop(itemId) {
      const item = await store.getItem(itemId);
      if (item === null) refuse(CODES.UNKNOWN_ITEM, `no stored item '${String(itemId)}'`);
      const record = await store.getDecisions(itemId);
      const decided = new Set((record?.revisions ?? []).map((revision) => revision.row_id));
      const pendingRows = item.row_ids.filter((rowId) => !decided.has(rowId));
      return {
        item_id: item.item_id,
        closed: pendingRows.length === 0,
        decided_rows: item.row_ids.filter((rowId) => decided.has(rowId)),
        pending_rows: pendingRows,
        decision_count: record?.revisions.length ?? 0,
      };
    },
  };
}
