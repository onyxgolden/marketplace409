/**
 * storeDouble.js — an in-memory double of the private Workbench
 * store's publish/decision contract (drop
 * tools/agent-workbench/private-store.mjs), for adapter tests.
 *
 * Mirrors only the semantics the adapter depends on: item-id shape,
 * idempotent publish (same identity minus published_at is a no-op),
 * REPUBLISH_CONFLICT on changed bytes, append-only decision
 * revisions under an idempotency key (same key + same material
 * fields is a replay; same key + different material refuses
 * DECISION_CONFLICT), and the store-side report-digest check.
 * It is test-only: it never touches a filesystem.
 */

import { canonicalStringify } from "../src/canonical.js";

export class StoreDoubleError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "StoreDoubleError";
    this.code = code;
  }
}

const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MATERIAL_FIELDS = ["item_id", "report_digest", "row_id", "actor", "decision", "note"];

function identityJson(item) {
  const { published_at, ...rest } = item;
  return canonicalStringify(rest);
}

function materialJson(decision) {
  const picked = {};
  for (const key of MATERIAL_FIELDS) {
    picked[key] = key === "note" ? (typeof decision?.note === "string" ? decision.note : "") : decision?.[key];
  }
  return JSON.stringify(picked);
}

export function createStoreDouble() {
  const items = new Map();
  const decisions = new Map();
  return {
    async putItem(item) {
      if (!item || typeof item.item_id !== "string" || !ITEM_ID_RE.test(item.item_id)) {
        throw new StoreDoubleError("BAD_ITEM", "item_id missing or malformed");
      }
      const prior = items.get(item.item_id) ?? null;
      if (prior !== null) {
        if (identityJson(prior) === identityJson(item)) {
          return { written: false, idempotent: true, item_id: item.item_id, write_receipt: null };
        }
        throw new StoreDoubleError("REPUBLISH_CONFLICT", item.item_id);
      }
      items.set(item.item_id, JSON.parse(JSON.stringify(item)));
      return { written: true, idempotent: false, item_id: item.item_id, write_receipt: { durable: true } };
    },
    async getItem(itemId) {
      if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId)) return null;
      const item = items.get(itemId) ?? null;
      return item === null ? null : JSON.parse(JSON.stringify(item));
    },
    async listItems() {
      return [...items.values()]
        .sort((a, b) => (a.item_id < b.item_id ? -1 : 1))
        .map((item) => ({
          item_id: item.item_id,
          agent: item.agent,
          kind: item.kind,
          title: item.title,
          synthetic: item.synthetic === true,
          published_at: item.published_at,
          report_digest: item.report_digest,
        }));
    },
    async appendDecision(item, decision, validate) {
      const record = decisions.get(item.item_id) ?? {
        item_id: item.item_id, report_digest: item.report_digest, revisions: [],
      };
      if (record.report_digest !== item.report_digest) {
        throw new StoreDoubleError("STALE_DIGEST", "decision record belongs to a different report revision");
      }
      validate(item, decision);
      const existing = record.revisions.find((r) => r.decision_id === decision.decision_id);
      if (existing) {
        if (materialJson(existing) !== materialJson(decision)) {
          throw new StoreDoubleError(
            "DECISION_CONFLICT",
            `decision_id '${decision.decision_id}' was already recorded with different material content`,
          );
        }
        return { revision: existing, idempotent: true, record };
      }
      const revision = { revision: record.revisions.length + 1, ...decision };
      record.revisions.push(revision);
      decisions.set(item.item_id, record);
      return { revision, idempotent: false, record };
    },
    async getDecisions(itemId) {
      if (typeof itemId !== "string" || !ITEM_ID_RE.test(itemId)) return null;
      const record = decisions.get(itemId) ?? null;
      return record === null ? null : JSON.parse(JSON.stringify(record));
    },
  };
}
