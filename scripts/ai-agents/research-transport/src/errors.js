/**
 * errors.js — the refusal type for the P1-B transport adapter.
 *
 * Every adapter-side failure is a TransportRefusal with a stable
 * machine-readable `code` and a human-readable `detail`. Callers
 * branch on `code`, never on message text. Store errors (the private
 * store's own coded errors, e.g. REPUBLISH_CONFLICT and
 * DECISION_CONFLICT) propagate unchanged — the adapter never
 * rewrites them, so a caller can tell an adapter refusal from a
 * store refusal by the error name. Pure Node 24 ESM, zero deps.
 */

export class TransportRefusal extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "TransportRefusal";
    this.code = code;
    this.detail = detail;
  }
}

/** Refusal codes for this slice's own checks. */
export const CODES = Object.freeze({
  /** The host did not supply a usable host principal (operator + workspace). */
  BAD_HOST_CONFIG: "BAD_HOST_CONFIG",
  /** A receipt/items bundle fails the transport's mapping preconditions. */
  BAD_PREVIEW_INPUT: "BAD_PREVIEW_INPUT",
  /** Two items in one run share one item key — decisions could not address them distinctly. */
  DUPLICATE_ITEM_KEY: "DUPLICATE_ITEM_KEY",
  /** No private store capability was injected, or it lacks a required method. */
  STORE_REQUIRED: "STORE_REQUIRED",
  /** The definition's operator scope does not match the host-registered principal. */
  PRINCIPAL_MISMATCH: "PRINCIPAL_MISMATCH",
  /** The receipt was computed under a different definition than the one given. */
  STALE_PREVIEW: "STALE_PREVIEW",
  /** A decision fails its binding contract (shape, enum, actor, timestamp, id). */
  BAD_DECISION: "BAD_DECISION",
  /** A decision names a different item than the one it is filed against. */
  ITEM_MISMATCH: "ITEM_MISMATCH",
  /** A decision names a report digest that is not the item's current digest. */
  STALE_DIGEST: "STALE_DIGEST",
  /** A decision names a row that is not part of the item. */
  UNKNOWN_ROW: "UNKNOWN_ROW",
  /** No stored item exists for the id a decision or read names. */
  UNKNOWN_ITEM: "UNKNOWN_ITEM",
});

export function refuse(code, detail = "") {
  throw new TransportRefusal(code, detail);
}
