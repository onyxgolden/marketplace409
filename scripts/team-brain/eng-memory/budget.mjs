// Team Brain eng-memory slice 1 — scoped consultation budgets.
// Pure, no I/O, no network, no model calls.
//
// Task-level accounting: every entrypoint creates its budgets fresh per
// invocation (task-level, never shared across calls) and threads them
// through every consultation phase — no phase resets to a fresh budget
// mid-task. Two budgets per entrypoint, each capped at CONSULTATION_CAP
// (64):
//
//   - config budget: host-config validation (assertHostConfig) — every
//     array index and nested candidate charged before its descriptor-safe
//     read; registered-task entries charged per entry.
//   - operation budget: capture/recall operation consultation —
//     authority/source/task checks, forbidden-value canary scan, and the
//     recall candidate drain.
//
// The contract's "64 consulted candidates" cap governs episode/candidate
// consultation; host-config consultation is separately bounded at 64 so a
// hostile 65-entry host collection dies on the charge. Either budget
// exceeding its cap throws (caught by the entrypoint and mapped to a
// REFUSED result), so no partial domain output is ever produced. A hostile
// 65th entry — e.g. a throwing-getter canary — dies on the charge with
// zero invocations.

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
