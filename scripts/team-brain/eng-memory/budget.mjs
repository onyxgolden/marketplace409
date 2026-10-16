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
//   - host admission: structural validation (exactly one unit) plus every
//     registration RECORD consulted on demand by the operation-phase
//     lookups — each charged BEFORE the record is read (see lazyRecords
//     in schemas.mjs). Admission never eagerly walks the registries: a
//     64+64 two-collection host consults only the records the task
//     actually needs, and the 65th consultation — whichever collection it
//     falls in — fails closed as BUDGET_EXHAUSTED with the record unread.
//   - operation consultation: forbidden-value canary scan and the recall
//     candidate drain — each candidate charged BEFORE its fields are
//     inspected (the drain's per-candidate charges are accounted
//     centrally even when the drain runs in a worker thread).
//
// Candidate definition: a top-level registration record, a recall
// candidate episode, or a host canary. Nested scalar collections inside a
// record (actions/tasks/sources arrays) are bounded structural data
// under the 64-entry bound, not separately charged candidates.
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
