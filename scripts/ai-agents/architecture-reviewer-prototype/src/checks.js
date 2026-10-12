/**
 * checks.js — trusted fixture check registry for the architecture-reviewer
 * prototype. Part of the scored implementation (pinned by the corpus
 * manifest). Defines the six bounded checks named by the brief, the
 * clause fields each requires, and the evaluation rules over extracted
 * clauses. Design facts are parsed from registered structured fixtures and
 * cite exact spans; there is no arbitrary architectural inference.
 *
 * Clause syntax (structured fixture docs only):
 *   [check:<check_id>] key: value; key2: value2
 *
 * A clause line may also carry `forbidden: <boundary>` to state an
 * explicit nonrepairable design boundary, or `unbounded: <field>` for an
 * explicitly unbounded control.
 */

export const CHECK_IDS = [
  "component-io",
  "migration-pre-post",
  "read-write-boundary",
  "retry-bounds",
  "rollback",
  "failure-handling",
];

export const RETRY_POLICY_MAX = 5;

/**
 * Required fields per check. Evaluation rules:
 * - every required field must be present with a non-empty value;
 * - a field value of "unbounded" (retry-bounds, read-write-boundary) is an
 *   explicit forbidden design boundary;
 * - a clause value of "none" for rollback is an explicit forbidden
 *   boundary ("no rollback by policy").
 */
export const CHECK_DEFS = {
  "component-io": {
    title: "component I/O contract",
    required: ["inputs", "outputs"],
    controlFields: ["inputs", "outputs"],
  },
  "migration-pre-post": {
    title: "migration pre/post conditions",
    required: ["precondition", "postcondition"],
    controlFields: ["precondition", "postcondition"],
  },
  "read-write-boundary": {
    title: "read/write boundary",
    required: ["reads", "writes"],
    controlFields: ["reads", "writes"],
  },
  "retry-bounds": {
    title: "retry bounds",
    required: ["max_retries"],
    controlFields: ["max_retries"],
  },
  "rollback": {
    title: "rollback",
    required: ["rollback"],
    controlFields: ["rollback"],
  },
  "failure-handling": {
    title: "failure handling",
    required: ["on_failure"],
    controlFields: ["on_failure"],
  },
};

/**
 * Evaluate one check against its clauses (already deduplicated).
 * Returns { pass, defects: [{kind, field, detail}], forbidden: null | {field, detail} }.
 * kinds: "missing-field", "retry-over-policy", "forbidden-boundary".
 */
export function evaluateCheck(checkId, clauses) {
  const def = CHECK_DEFS[checkId];
  if (!def) throw new Error(`unknown check: ${checkId}`);
  const defects = [];
  let forbidden = null;

  // Merge fields across clauses: contradictions are handled by the
  // reviewer before this runs, so evaluation sees consistent values.
  const merged = {};
  for (const c of clauses) Object.assign(merged, c.fields);

  for (const f of def.required) {
    const v = merged[f];
    if (v === undefined || v === "") {
      defects.push({ kind: "missing-field", field: f, detail: `required field '${f}' absent` });
      continue;
    }
    if (checkId === "retry-bounds" && f === "max_retries") {
      if (/^unbounded$/i.test(v.trim())) {
        forbidden = { field: f, detail: "explicitly unbounded retries — forbidden design boundary" };
      } else {
        const n = Number(v.trim());
        if (!Number.isInteger(n) || n < 0) {
          defects.push({ kind: "invalid-field", field: f, detail: `max_retries '${v}' is not a non-negative integer` });
        } else if (n > RETRY_POLICY_MAX) {
          defects.push({ kind: "retry-over-policy", field: f, detail: `max_retries ${n} exceeds policy max ${RETRY_POLICY_MAX}` });
        }
      }
    }
    if (checkId === "rollback" && f === "rollback") {
      if (/^(none|no rollback|no-rollback)$/i.test(v.trim())) {
        forbidden = { field: f, detail: "explicit no-rollback policy — forbidden design boundary" };
      }
    }
    if (checkId === "read-write-boundary" && /^unbounded$/i.test(String(v).trim()) && (f === "reads" || f === "writes")) {
      forbidden = { field: f, detail: `explicitly unbounded ${f} — forbidden design boundary` };
    }
  }
  return { pass: defects.length === 0 && forbidden === null, defects, forbidden };
}

/**
 * Detect contradictions among clauses of one check: the same control
 * field with different normalized values. Both clauses are preserved —
 * never averaged. Returns pairs [{a, b, field, valueA, valueB}].
 */
export function detectContradictions(checkId, clauses) {
  const def = CHECK_DEFS[checkId];
  const pairs = [];
  const norm = (v) => String(v).trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < clauses.length; i++) {
    for (let j = i + 1; j < clauses.length; j++) {
      for (const f of def.controlFields) {
        const va = clauses[i].fields[f];
        const vb = clauses[j].fields[f];
        if (va === undefined || vb === undefined || va === "" || vb === "") continue;
        if (norm(va) !== norm(vb)) {
          pairs.push({ a: clauses[i], b: clauses[j], field: f, valueA: va, valueB: vb });
        }
      }
    }
  }
  return pairs;
}
