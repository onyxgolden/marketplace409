/**
 * budget.js — per-run budget accounting for P1-A previews.
 *
 * The job definition carries the per-run caps (validated against the
 * hard ceilings in jobDefinition.js). This class accounts consumption
 * during a preview build: every consume() call refuses BEFORE the
 * consumer touches the next item when the cap would be exceeded, so a
 * budget-exhausted run never produces totals from a partially
 * consumed population and never touches the forbidden tail item.
 * Pure Node 24 ESM, zero deps.
 */

import { CODES, refuse } from "./errors.js";

export class RunBudget {
  constructor(limits) {
    this.limits = {
      max_items_per_run: limits.max_items_per_run,
      max_bytes_per_run: limits.max_bytes_per_run,
      max_tool_calls_per_run: limits.max_tool_calls_per_run,
    };
    this.used = { items: 0, bytes: 0, tool_calls: 0 };
  }

  /** True iff consuming n more of kind stays within the cap. */
  fits(kind, n = 1) {
    const capKey = kind === "items" ? "max_items_per_run"
      : kind === "bytes" ? "max_bytes_per_run" : "max_tool_calls_per_run";
    return this.used[kind] + n <= this.limits[capKey];
  }

  /** Charge n of kind, refusing first when the cap would be exceeded. */
  consume(kind, n = 1) {
    if (!this.fits(kind, n)) {
      refuse(CODES.BUDGET_EXCEEDED, `${kind} would exceed cap ${this.limits[kind === "items" ? "max_items_per_run" : kind === "bytes" ? "max_bytes_per_run" : "max_tool_calls_per_run"]} (used ${this.used[kind]}, attempted +${n})`);
    }
    this.used[kind] += n;
    return this.used[kind];
  }

  consumeItem() { return this.consume("items", 1); }
  consumeBytes(n) { return this.consume("bytes", n); }
  consumeToolCall() { return this.consume("tool_calls", 1); }

  /** Snapshot for the run receipt. */
  receipt() {
    return {
      max_items_per_run: this.limits.max_items_per_run,
      max_bytes_per_run: this.limits.max_bytes_per_run,
      max_tool_calls_per_run: this.limits.max_tool_calls_per_run,
      items_used: this.used.items,
      bytes_used: this.used.bytes,
      tool_calls_used: this.used.tool_calls,
    };
  }
}
