// The one rule for every FORGE write gate, shared by the reconciliation
// panels and any other UI that mutates the books.
//
// Typed CONFIRM (checkbox + typing CONFIRM) is reserved for work that is
// ambiguous, irreversible, or touches debt/transfer pairing logic -- the
// places where a wrong bulk apply has corrupted the books before (see the
// HELOC sign incident). Everything else -- an explicit human choice, or an
// exact system match, that can be undone through an existing path -- is a
// single click.
//
// This is the client-side counterpart of the Brain's server-enforced
// requiredConfirmationForPlan() in brain/buildActionPlan.js: same 0.8
// confidence threshold, same "typed | single" levels. The server always
// re-checks its own gate; this helper only decides which gate the UI shows.
// No LLM calls, no I/O -- pure decision logic.

import { CONFIDENCE_GATE_THRESHOLD } from "@/domains/ledger/brain/buildActionPlan.js";

export const ACTION_GATE = Object.freeze({
  SINGLE: "single",
  TYPED: "typed",
});

/**
 * resolveActionGate({ confidence, ambiguous, reversible, touchesDebtOrTransfer })
 *
 * - ambiguous: the system is guessing (auto-paired rows, bulk inference).
 *   Exact matches the human reviewed row-by-row are NOT ambiguous.
 * - reversible: a user-facing undo path exists (re-categorize, re-mark,
 *   un-exclude). "Recoverable by SQL" does not count.
 * - touchesDebtOrTransfer: the write goes through transfer/distribution/debt
 *   pairing logic. Always the heavy gate, regardless of the other flags.
 * - confidence: 0..1. Below the shared 0.8 threshold the match is treated
 *   as ambiguous.
 *
 * Returns "typed" or "single". Never throws on malformed input -- when in
 * doubt the heavy gate wins.
 */
export function resolveActionGate(options = {}) {
  const {
    confidence,
    ambiguous = false,
    reversible = true,
    touchesDebtOrTransfer = false,
  } = options ?? {};

  if (touchesDebtOrTransfer) return ACTION_GATE.TYPED;
  if (ambiguous) return ACTION_GATE.TYPED;
  if (reversible !== true) return ACTION_GATE.TYPED;
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence < CONFIDENCE_GATE_THRESHOLD) {
    return ACTION_GATE.TYPED;
  }
  return ACTION_GATE.SINGLE;
}
