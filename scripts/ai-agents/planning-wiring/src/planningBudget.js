/**
 * Planning-lane invocation budget limits (brief §11).
 *
 * Shared by the planning runner (main thread) and the planning
 * execution worker so both sides of the worker boundary enforce
 * exactly the same caps: one monotonic invocation budget, <=64
 * consulted candidate objects, <=512 evidence spans, <=256 KiB
 * serialized UTF-8 input, <=256 public output records / 256 KiB
 * final envelope, depth <=32, external 5-second computation
 * deadline (EXECUTION_BOUNDARY_MS), separately bounded publication
 * (PUBLICATION_BOUND_MS), 2-second single-page reads.
 *
 * The ONLY deliberate difference from the P2a limits is depth:
 * P2a admits to depth 16; the P2b brief states depth <=32 (the
 * scheduler prototype's contract depth), and planning snapshot
 * structures nest deeper than rental rows. Every other cap is
 * identical to P2a's — no cap is raised to retain an old count, and
 * streaming/portfolio batching/raised caps are OUT (a later
 * capacity slice must preserve graph/coverage semantics).
 */
import { Budget, BUDGET_LIMITS } from "../../../../src/application/ai-lab/rental-ops/budgets.js";

export const PLANNING_BUDGET_LIMITS = Object.freeze({
  ...BUDGET_LIMITS,
  depth: 32,
});

export function createPlanningBudget() {
  return new Budget(PLANNING_BUDGET_LIMITS);
}
