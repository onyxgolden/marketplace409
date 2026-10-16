// Team Brain eng-memory slice 1 — scoped consultation budgets.
// Pure, no I/O, no network, no model calls.
//
// Task-level aggregate accounting: every entrypoint creates ONE budget per
// invocation (task-level, never shared across calls) and threads it
// through host admission AND the operation. Two independent 64-unit
// budgets (one for config, one for operation) let a single invocation
// consult 112 units, exceeding the contract's 64-candidate task cap —
// the aggregate budget makes that impossible: the charge that would cross
// 64 never returns, wherever it occurs.
//
// The single budget (cap CONSULTATION_CAP = 64) covers:
//   - host admission (assertHostConfig): exactly one unit. Admission is
//     BOUNDED, not per-entry charged — every host collection is limited
//     to the scoped 64-entry bound, enforced before any entry is read,
//     so a hostile 65th entry fails closed as BUDGET_EXHAUSTED with zero
//     invocations. Per-entry charging of the host's own registries would
//     consume the task budget before any operation; the bound provides
//     the same fail-closed guarantee without that cost.
//   - operation consultation: forbidden-value canary scan, authority/
//     source/task checks, and the recall candidate drain — each candidate
//     charged BEFORE its fields are inspected.
//
// Exceeding the cap throws (caught by the entrypoint and mapped to a
// REFUSED result), so no partial domain output is ever produced.

import { ENG_CODES, fail } from "./errors.mjs";

export const CONSULTATION_CAP = 64;

export class ConsultationBudget {
  constructor(cap = CONSULTATION_CAP, code = ENG_CODES.BUDGET_EXHAUSTED) {
    this.cap = cap;
    this.code = code;
    this.spent = 0;
  }

  /**
   * Charge n units of consultation before inspecting the thing they pay
   * for. Throws (fail) when the cap would be exceeded — the charge that
   * crosses the cap never returns, so the over-budget entry is never read.
   */
  charge(n = 1, what = "candidate") {
    this.spent += n;
    if (this.spent > this.cap) {
      fail(this.code, `Consultation budget exceeded while consulting ${what}`, {
        what,
        spent: this.spent,
        cap: this.cap,
      });
    }
    return this.spent;
  }
}
