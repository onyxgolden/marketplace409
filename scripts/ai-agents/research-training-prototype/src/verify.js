/**
 * verify.js — Research v2 taxonomy derivation for the Research
 * Training Agent prototype.
 *
 * Taxonomy (precedence: contradicted > supported > attributed-only >
 * unsupported), keyed by (subject, predicate, scope):
 *  - CONTRADICTED: admitted assertions for the key disagree on value
 *    or polarity. Contradiction takes precedence over everything; the
 *    key is blocked from teaching and no quiz/answer is emitted for it.
 *  - SUPPORTED: all admitted assertions agree, and they come from at
 *    least two INDEPENDENT evidence roots (provenance groups whose
 *    sources are not known copies of one another, directly or
 *    transitively).
 *  - ATTRIBUTED-ONLY: all agree but the evidence reduces to a single
 *    root (one source, duplicates of it, known copies, citation
 *    cycles, or unknown independence). Taught only as
 *    "Fixture source states…", never as established truth.
 *  - UNSUPPORTED: no admitted assertion (gap / denied / quarantined).
 *
 * Duplicates and known copying never corroborate: corroboration counts
 * evidence ROOTS (the transitive closure of the host-declared
 * copied_from relation), not passages.
 */

/**
 * The grammar key for an assertion. PER-006: the encoding is a framed
 * tuple (JSON array), never bare concatenation — ("a","bc","d") and
 * ("ab","c","d") are distinct keys and can never merge into one fact.
 */
export function assertionKey(a) {
  return JSON.stringify([a.subject, a.predicate, a.scope]);
}

/** Human-readable key for notes. */
export function keyLabel(a) {
  return `${a.subject} | ${a.predicate} | ${a.scope}`;
}

/**
 * Resolve the evidence root of a source key by following the
 * host-declared copied_from chain to its ancestor. A cycle (citation
 * cycle) canonicalizes to its smallest member, so every member of the
 * cycle shares one root and contributes no independence.
 */
export function evidenceRoot(sourceKey, provenanceSources) {
  const path = [];
  let cur = sourceKey;
  while (true) {
    const idx = path.indexOf(cur);
    if (idx >= 0) return path.slice(idx).sort()[0];
    path.push(cur);
    const entry = provenanceSources[cur];
    if (!entry || entry.copied_from === null || entry.copied_from === undefined) return cur;
    cur = entry.copied_from;
  }
}

/**
 * PER-003: the corroboration-bearing variant of evidenceRoot. Returns
 * the evidence root ONLY when every key on the copied_from chain —
 * the source itself, every link, the terminal root, and every member
 * of a citation cycle — is fully registered in the provenance map.
 * Any missing registration makes the root UNKNOWN (null): unknown
 * provenance never supplies an independent group and can never
 * increase support. (A source whose own provenance entry carries an
 * applies_to list that does not name the consumed SourceRef is
 * marked _provUnknown by the caller and excluded before this walk.)
 */
export function registeredEvidenceRoot(sourceKey, provenanceSources) {
  const path = [];
  let cur = sourceKey;
  while (true) {
    const idx = path.indexOf(cur);
    if (idx >= 0) return path.slice(idx).sort()[0];
    const entry = provenanceSources[cur];
    if (!entry) return null;
    path.push(cur);
    if (entry.copied_from === null || entry.copied_from === undefined) return cur;
    cur = entry.copied_from;
  }
}

/**
 * Group admitted (span-verified, non-quarantined) assertions by key and
 * derive the Research v2 status of each key.
 *
 * @param {Array} admitted — assertions enriched with _sourceKey (the
 *   "repo|path" of the source their passage came from).
 * @param {object} provenanceSources — validated provenance.sources map.
 * @returns {Map<string, {status, key, label, assertions, roots:Set}>}
 */
export function deriveKeyStatuses(admitted, provenanceSources) {
  const byKey = new Map();
  for (const a of admitted) {
    const k = assertionKey(a);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(a);
  }
  const out = new Map();
  for (const [k, list] of byKey) {
    const first = list[0];
    // PER-003: only fully registered evidence roots corroborate.
    // Assertions whose provenance is unknown (unregistered source,
    // broken copy chain, or an applies_to list that does not name
    // the consumed pin) contribute no root and no group.
    const roots = new Set();
    for (const a of list) {
      if (a._provUnknown) continue;
      const r = registeredEvidenceRoot(a._sourceKey, provenanceSources);
      if (r !== null) roots.add(r);
    }
    const rootGroups = new Set([...roots].map((r) => provenanceSources[r].group));
    // Contradiction: any disagreement on (value, polarity) for the key.
    let contradicted = false;
    for (const a of list) {
      if (a.value !== first.value || a.polarity !== first.polarity) contradicted = true;
    }
    // Supported needs at least two independent evidence roots in at
    // least two distinct provenance groups: duplicates, copies and
    // same-group originals never corroborate.
    let status;
    if (contradicted) status = "contradicted";
    else if (roots.size >= 2 && rootGroups.size >= 2) status = "supported";
    else status = "attributed-only";
    out.set(k, {
      status,
      key: k,
      label: keyLabel(first),
      assertions: list,
      roots,
      value: first.value,
      polarity: first.polarity,
    });
  }
  return out;
}

/**
 * Build the fixed short-answer question for an atomic assertion from
 * the host-pinned template registry. The template's question_form is a
 * literal form with {subject}, {predicate}, {scope} slots filled from
 * the assertion's exact tokens — no freeform generation.
 */
export function buildQuestion(template, a) {
  const form = template?.question_form ?? "What is the {predicate} of {subject} ({scope})?";
  return form
    .replaceAll("{subject}", a.subject)
    .replaceAll("{predicate}", a.predicate)
    .replaceAll("{scope}", a.scope);
}

/**
 * Build the fixed composite question for exactly two atoms: asks for
 * both labeled values, in atom order. No connective synthesis.
 */
export function buildCompositeQuestion(a, b) {
  return `State both values: (1) the ${a.predicate} of ${a.subject} (${a.scope}); (2) the ${b.predicate} of ${b.subject} (${b.scope}).`;
}

/**
 * Build a taught statement for an admitted assertion. Attributed-only
 * material is always attributed ("Fixture source states…");
 * supported material is stated plainly with its status visible.
 */
export function buildStatement(status, a) {
  const core = `${a.subject} | ${a.predicate} | ${a.value} | ${a.scope}`;
  if (status === "attributed-only") return `Fixture source states: ${core}`;
  return core;
}
