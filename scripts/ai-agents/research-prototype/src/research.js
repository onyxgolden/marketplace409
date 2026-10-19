/**
 * research.js — the Research Agent's claim-evaluation engine.
 * Pure functions over validated, admitted, span-verified data.
 *
 * Binding taxonomy (Research v2, October 19 clarifications):
 *   contradicted > supported > attributed-only > unsupported
 *
 * - Attribution (fidelity): the requested atom matches an assertion in a
 *   declared origin passage, byte-exact, typed, polarity-exact.
 * - Corroboration: a DISTINCT verified passage carries the same assertion
 *   as underlying content, in a DIFFERENT host-registered provenance
 *   group, with no derivation/copy link to the origin passage. A
 *   citation pointer, a self-certification, an authority label, or a
 *   citation cycle contributes zero corroboration. Unknown independence
 *   (unregistered passage) => UNCORROBORATED.
 * - Contradiction: same subject/predicate/scope, same value type, with a
 *   differing typed scalar value or opposite polarity. Different scope
 *   or different value type is not a conflict. Compound claims are
 *   separated into atoms; each atom is judged alone.
 *
 * "Supported" means supported within this synthetic bundle — never a
 * claim about real-world truth. The agent never browses, never retrieves,
 * never asserts facts about the world.
 *
 * Pure Node 24 ESM, zero dependencies. All budget charging happens in
 * the caller (index.js); these functions never read uncharged data.
 */

import { renderAssertionText, SchemaError } from "./schemas.js";
import { sha256HexUtf8, canonicalJson } from "./canonical.js";

export class ResearchSpanError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResearchSpanError";
    this.code = code;
  }
}

/**
 * Exact typed assertion equality. Numbers and strings never match across
 * the type boundary ("5" !== 5); polarity is part of identity.
 */
export function sameAssertion(a, b) {
  return (
    a.subject === b.subject &&
    a.predicate === b.predicate &&
    a.value_type === b.value_type &&
    valuesEqual(a.value_type, a.value, b.value) &&
    a.scope === b.scope &&
    a.polarity === b.polarity
  );
}

function valuesEqual(valueType, v1, v2) {
  if (valueType === "number") return v1 === v2; // finite numbers only, validated
  return v1 === v2;
}

/**
 * Conflict predicate: same subject/predicate/scope and same value type,
 * with a differing typed scalar value OR opposite polarity. Different
 * scope, different value type, or compound separation => no conflict.
 */
export function assertsConflict(a, b) {
  if (a.subject !== b.subject) return false;
  if (a.predicate !== b.predicate) return false;
  if (a.scope !== b.scope) return false;
  if (a.value_type !== b.value_type) return false;
  if (a.polarity !== b.polarity) return true; // opposite polarity conflicts
  return !valuesEqual(a.value_type, a.value, b.value);
}

/**
 * Verify one fixture assertion's byte span against the passage bytes.
 * Reconstructs the expected quoted text from the structured fields —
 * the agent never trusts a fixture-carried quote string. Charges one span.
 * Throws ResearchSpanError("SPAN_MISMATCH") on any divergence.
 */
export function verifyAssertionSpan(passageBytes, assertion, budget, what) {
  budget.countSpan(what);
  const expected = renderAssertionText(assertion);
  const { start_byte, end_byte } = assertion.span;
  if (
    !Number.isInteger(start_byte) || !Number.isInteger(end_byte) ||
    start_byte < 0 || end_byte < start_byte || end_byte > passageBytes.length
  ) {
    throw new ResearchSpanError("SPAN_MISMATCH", `assertion span [${start_byte}, ${end_byte}) is outside the passage bytes`);
  }
  const slice = passageBytes.subarray(start_byte, end_byte).toString("utf8");
  if (slice !== expected) {
    throw new ResearchSpanError("SPAN_MISMATCH", "assertion span bytes do not decode to the reconstructed assertion text");
  }
  return { start_byte, end_byte, quoted_text: expected };
}

/**
 * Detect document-level citation cycles from the citation graph.
 * Returns a Set of doc_ids that lie on at least one directed cycle.
 * Iterative DFS — bounded by the validated citation counts.
 */
export function detectCitationCycles(docCitations) {
  const docs = [...docCitations.keys()];
  const onCycle = new Set();
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(docs.map((d) => [d, WHITE]));
  const stack = [];
  function dfs(u) {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of docCitations.get(u) || []) {
      if (!docCitations.has(v)) continue; // dangling citation target: inert, not a cycle
      if (color.get(v) === GRAY) {
        for (let i = stack.indexOf(v); i < stack.length; i++) onCycle.add(stack[i]);
      } else if (color.get(v) === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  }
  for (const d of docs) {
    if (color.get(d) === WHITE) dfs(d);
  }
  return onCycle;
}

function registryKey(docId, passageId) {
  return `${docId}|${passageId}`;
}

/**
 * Corroboration classification for one candidate passage against the
 * origin passage. Returns one of:
 *   "independent" | "same_group" | "unregistered" | "derivation_linked"
 */
export function classifyCorroboration(originRef, candRef, provenanceRegistry) {
  const oKey = registryKey(originRef.doc_id, originRef.passage_id);
  const cKey = registryKey(candRef.doc_id, candRef.passage_id);
  const oReg = provenanceRegistry[oKey];
  const cReg = provenanceRegistry[cKey];
  if (!oReg || !cReg) return "unregistered";
  if (oReg.provenance_group_id === cReg.provenance_group_id) return "same_group";
  const linked =
    (cReg.derivation_links || []).some((l) => l.from_doc === originRef.doc_id && l.from_passage === originRef.passage_id) ||
    (oReg.derivation_links || []).some((l) => l.from_doc === candRef.doc_id && l.from_passage === candRef.passage_id);
  if (linked) return "derivation_linked";
  return "independent";
}

/**
 * Evaluate one requested atom against the verified assertion index.
 *
 * verifiedIndex: [{doc_id, passage_id, assertion_id, atom:{...}, span, quoted_text}]
 *   — every entry has a verified byte span and comes from a
 *   non-quarantined passage.
 * provenanceRegistry: host-registered {group, derivation_links} per passage.
 * citationCycles: Set of doc_ids on a citation cycle.
 *
 * Returns the atom result with fidelity, corroboration, contradictions,
 * and the final research_status.
 */
export function evaluateAtom(atom, originRefs, verifiedIndex, provenanceRegistry, citationCycles) {
  // ---- Fidelity: the atom must match a verified assertion in a declared
  // origin passage, byte-exact and typed. ----
  let fidelity = "NOT_FAITHFUL";
  let origin = null;
  let fidelityReason = originRefs.length === 0
    ? "no origin passage reference declared"
    : "no declared origin passage carries this exact assertion";
  if (originRefs.length > 0) {
    for (const ref of originRefs) {
      const hit = verifiedIndex.find(
        (e) => e.doc_id === ref.doc_id && e.passage_id === ref.passage_id && sameAssertion(e.atom, atom)
      );
      if (hit) {
        fidelity = "FAITHFUL";
        fidelityReason = null;
        origin = { doc_id: hit.doc_id, passage_id: hit.passage_id, assertion_id: hit.assertion_id, citation: hit.citation };
        break;
      }
    }
  }

  // ---- Corroboration: distinct verified passages with the same
  // assertion as underlying content. ----
  const evidence = [];
  const sameGroup = [];
  const unregistered = [];
  const derivationLinked = [];
  if (fidelity === "FAITHFUL") {
    for (const e of verifiedIndex) {
      if (e.doc_id === origin.doc_id && e.passage_id === origin.passage_id) continue;
      if (!sameAssertion(e.atom, atom)) continue;
      const cls = classifyCorroboration(
        { doc_id: origin.doc_id, passage_id: origin.passage_id },
        { doc_id: e.doc_id, passage_id: e.passage_id },
        provenanceRegistry
      );
      const rec = { doc_id: e.doc_id, passage_id: e.passage_id, assertion_id: e.assertion_id, provenance_group_id: provenanceRegistry[registryKey(e.doc_id, e.passage_id)]?.provenance_group_id ?? null, citation: e.citation };
      if (cls === "independent") evidence.push(rec);
      else if (cls === "same_group") sameGroup.push(rec);
      else if (cls === "unregistered") unregistered.push(rec);
      else derivationLinked.push(rec);
    }
  }
  const corroborationState = evidence.length > 0 ? "CORROBORATED" : "UNCORROBORATED";

  // ---- Contradiction: any verified relevant passage with a conflicting
  // assertion. Every supporting and opposing passage is preserved; the
  // agent never picks a winner. ----
  const contradictions = [];
  for (const e of verifiedIndex) {
    if (!assertsConflict(e.atom, atom)) continue;
    contradictions.push({
      doc_id: e.doc_id,
      passage_id: e.passage_id,
      assertion_id: e.assertion_id,
      assertion_text: e.quoted_text,
      citation: e.citation,
    });
  }

  // ---- Status precedence: contradicted > supported > attributed-only > unsupported. ----
  let research_status;
  if (contradictions.length > 0) research_status = "contradicted";
  else if (fidelity === "FAITHFUL" && corroborationState === "CORROBORATED") research_status = "supported";
  else if (fidelity === "FAITHFUL") research_status = "attributed-only";
  else research_status = "unsupported";

  const inCycle = origin !== null && citationCycles.has(origin.doc_id);

  return {
    claim_id: null, // filled by the caller
    canonical_key: sha256HexUtf8(canonicalJson([
      atom.subject, atom.predicate, atom.value_type,
      atom.value_type === "number" ? String(atom.value) : atom.value,
      atom.scope, atom.polarity,
      origin ? `${origin.doc_id}|${origin.passage_id}` : null,
    ])),
    original_text: renderAssertionText(atom),
    atom: { ...atom },
    origin: origin === null
      ? { fidelity, reason: fidelityReason, citation: null }
      : { doc_id: origin.doc_id, passage_id: origin.passage_id, assertion_id: origin.assertion_id, fidelity, citation: origin.citation },
    fidelity,
    corroboration: {
      state: corroborationState,
      evidence,
      same_group_occurrences: sameGroup,
      unregistered_candidates: unregistered,
      derivation_linked_candidates: derivationLinked,
    },
    contradictions,
    citation_cycle: inCycle,
    research_status,
  };
}

export { SchemaError };
