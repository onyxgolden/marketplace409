/**
 * contextGuard.js — charges and validates the trusted, host-injected
 * context under the SAME monotonic per-task budget that gates this
 * agent's own domain candidates (work orders, PM occurrences).
 *
 * Lesson carried forward from this program's Customer Success (CS-001)
 * and Document Agent (DOC-002) findings: validating the context as one
 * unguarded eager pass — enumerating every registered source, revision,
 * read grant and criteria entry before any budget charge — lets an
 * unused, oversized registry entry bypass the 256 KiB / 64-object budget
 * entirely. The fix is incremental charge-before-read discipline applied
 * to the context's OWN registry: every principal record, criteria
 * container, read grant, source key and revision is charged with
 * budget.countObject() BEFORE any of its fields are read; AND every
 * registered revision's text is additionally charged against the 256
 * KiB payload budget via budget.countPayload() the instant its shape is
 * validated — not only when a specific revision is later resolved for
 * actual use.
 *
 * Deliberately conservative: a source/revision that is BOTH registered
 * (charged here) AND later actually resolved for use (charged again by
 * resolver.resolveSourceRef) is charged twice. This over-bounds rather
 * than under-bounds consultation against the shared budget.
 *
 * Source keys and each source's revision keys are walked in sorted
 * (lexicographic) order, not raw object-insertion order, so which
 * entries get charged before a mid-walk BUDGET_EXCEEDED is deterministic.
 */

import {
  validateContextShape,
  validateSourceEntryShape,
  validateRevisionEntry,
  validatePrincipal,
  validateCriteria,
  validateReadGrant,
} from "./schemas.js";

/**
 * chargeContext(rawContext, budget) -> {clock, sources, readGrants,
 * principal, criteria}. Throws SchemaError (shape/field validation) or
 * BudgetError (from budget.countObject) — both are caught by the single
 * try/catch in src/index.js around this call.
 */
export function chargeContext(rawContext, budget) {
  const shape = validateContextShape(rawContext);

  budget.countObject("context.principal");
  const principal = validatePrincipal(shape.principalRaw, "context.principal");

  budget.countObject("context.criteria");
  const criteria = validateCriteria(shape.criteriaRaw, "context.criteria");

  const readGrants = [];
  for (let i = 0; i < shape.readGrantsRaw.length; i++) {
    budget.countObject(`context.readGrants[${i}]`);
    readGrants.push(validateReadGrant(shape.readGrantsRaw[i], `context.readGrants[${i}]`));
  }

  const sortedSourceKeys = [...shape.sourceKeys].sort();
  for (const sk of sortedSourceKeys) {
    budget.countObject(`context.sources[${sk}]`);
    const entry = shape.sources[sk];
    const commits = validateSourceEntryShape(entry, `context.sources[${sk}]`);
    for (const commit of [...commits].sort()) {
      budget.countObject(`context.sources[${sk}]@${commit}`);
      const rev = validateRevisionEntry(entry.revisions[commit], `context.sources[${sk}]@${commit}`);
      // The exact CS-001/DOC-002 gap: registered revision BYTES were
      // never charged against the 256 KiB payload budget just because a
      // revision happens to be unused by this task. Charge it the
      // instant its shape is validated, regardless of use.
      budget.countPayload(rev.text, `context.sources[${sk}]@${commit}`);
    }
  }

  return { clock: shape.clock, sources: shape.sources, readGrants, principal, criteria };
}
