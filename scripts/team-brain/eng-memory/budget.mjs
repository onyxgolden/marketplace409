// Team Brain eng-memory slice 1 — scoped consultation budgets.
// Pure, no I/O, no network, no model calls.
//
// Every phase that consults host-supplied or input-derived metadata gets
// its own budget instance, each capped at CONSULTATION_CAP (64):
//
//   - host-config validation (assertHostConfig)
//   - capture validation (forbidden-value scan + authority/source/task checks)
//   - recall candidate drain (sync and async)
//
// Charge BEFORE inspecting: budget.charge() is called before the
// candidate/canary/registration entry it pays for is read. Exceeding the
// cap throws (caught by the entrypoint and mapped to a REFUSED result),
// so no partial domain output is ever produced. A hostile 65th entry —
// e.g. a throwing-getter canary — dies on the charge with zero invocations.

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
