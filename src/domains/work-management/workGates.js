// FORGE Work Management — Readiness Engine domain (Rung 3).
//
// Pure, deterministic domain logic: no DB, no network, no Date.now().
// Answers "can this work start?" for each readiness gate on a package.
//
// Model:
//   Attestations (Rung 1, human input) -> Evaluations (Rung 3, engine verdict)
//     -> Overrides (Rung 3, human exception).
//   An evaluation is append-only history. An override is a separate human
//   decision with an expiry — it never rewrites the evaluation.
//
// Verdicts:
//   ready     — the gate is satisfied; work may proceed past it.
//   not_ready — the gate is not satisfied; work is blocked.
//   unknown   — cannot determine; absence of evidence is never evidence
//               (Rung 1 rule). Unknown blocks like not_ready, but the
//               reason says "no data" instead of "failed check".

// The 12 readiness gates (mirrors the Rung 1 CHECK constraint).
export const WORK_GATES = Object.freeze([
  "scope",
  "design",
  "predecessor",
  "material",
  "crew",
  "permit",
  "site",
  "safety",
  "evidence",
  "equipment_readiness",
  "inspection_prerequisite",
  "logistics",
]);

// Evaluation verdicts.
export const GATE_VERDICTS = Object.freeze(["ready", "not_ready", "unknown"]);

// Plain-English labels for the novice UI.
export const GATE_LABELS = Object.freeze({
  scope: "Scope is defined and approved",
  design: "Design / drawings are ready",
  predecessor: "Predecessor work is complete",
  material: "Materials are on site",
  crew: "Crew is assigned and available",
  permit: "Permits are in hand",
  site: "Site is accessible and prepared",
  safety: "Safety requirements are met",
  evidence: "Required evidence is filed",
  equipment_readiness: "Equipment is ready",
  inspection_prerequisite: "Inspection prerequisites are met",
  logistics: "Logistics are arranged",
});

function assertGate(gate) {
  if (!WORK_GATES.includes(gate)) {
    throw new Error(`Unknown gate: ${gate}`);
  }
}

function assertVerdict(verdict) {
  if (!GATE_VERDICTS.includes(verdict)) {
    throw new Error(`Unknown verdict: ${verdict}`);
  }
}

/**
 * Compute a gate verdict from the latest attestation.
 *
 * @param {object} input
 * @param {string} input.gate — one of WORK_GATES
 * @param {object|null} input.attestation — latest attestation row or null.
 *   Shape: { statement, not_applicable, na_reason }.
 * @returns {{ verdict, reason }} — reason is human-readable.
 *
 * Rules:
 * - Attestation marked not_applicable with a reason -> ready (gate waived
 *   for this package; the waiver itself is the evidence).
 * - Attestation marked not_applicable WITHOUT a reason -> unknown
 *   (a bare waiver explains nothing).
 * - No attestation at all -> unknown (absence is never evidence).
 * - Attestation present -> ready.
 *
 * Note: signal-contradiction checks (material not received, crew not
 * assigned, etc.) are intentionally absent. Those signals have no
 * authoritative tables yet; caller-supplied signals are writer-controlled
 * and cannot serve as the basis for a trusted verdict. When the
 * material/crew/permit/predecessor tables land, the database trigger will
 * derive signals from those records directly.
 */
export function evaluateGate({ gate, attestation = null }) {
  assertGate(gate);

  if (!attestation) {
    return {
      verdict: "unknown",
      reason: `No attestation recorded for the ${gate} gate.`,
    };
  }

  if (attestation.not_applicable) {
    if (attestation.na_reason && attestation.na_reason.trim()) {
      return {
        verdict: "ready",
        reason: `Gate waived: ${attestation.na_reason.trim()}`,
      };
    }
    return {
      verdict: "unknown",
      reason: `Gate marked not-applicable without a reason for ${gate}.`,
    };
  }

  return {
    verdict: "ready",
    reason: attestation.statement || `Attested ready for ${gate}.`,
  };
}

/**
 * Is a single gate satisfied right now?
 *
 * @param {object} input
 * @param {object|null} input.latestEvaluation — latest evaluation row or null.
 *   Shape: { verdict }.
 * @param {Array} input.activeOverrides — unexpired override rows (may be empty).
 * @returns {{ satisfied: bool, via: 'evaluation'|'override'|'none', detail: string }}
 *
 * An unexpired override satisfies the gate regardless of the evaluation.
 * Otherwise the latest evaluation's verdict governs. No evaluation and no
 * override means not satisfied.
 */
export function isGateSatisfied({ latestEvaluation = null, activeOverrides = [] }) {
  if (activeOverrides.length > 0) {
    const o = activeOverrides[0];
    return {
      satisfied: true,
      via: "override",
      detail: `Overridden by ${o.override_by}: ${o.reason}`,
    };
  }
  if (!latestEvaluation) {
    return {
      satisfied: false,
      via: "none",
      detail: "No evaluation recorded and no active override.",
    };
  }
  assertVerdict(latestEvaluation.verdict);
  if (latestEvaluation.verdict === "ready") {
    return {
      satisfied: true,
      via: "evaluation",
      detail: latestEvaluation.reason || "Latest evaluation is ready.",
    };
  }
  return {
    satisfied: false,
    via: "none",
    detail:
      latestEvaluation.verdict === "unknown"
        ? `Gate unevaluated: ${latestEvaluation.reason || "no data"}`
        : `Gate not ready: ${latestEvaluation.reason || "see evaluation"}`,
  };
}

/**
 * Is the whole package ready? Every applicable gate must be satisfied.
 *
 * @param {object} input
 * @param {Array<string>} input.applicableGates — gates for the package type.
 * @param {Function} input.getGateState — (gate) => { latestEvaluation, activeOverrides }.
 * @returns {{ ready: bool, gates: Record<gate, gateResult>, blocking: Array<string> }}
 */
export function isPackageReady({ applicableGates, getGateState }) {
  if (!applicableGates || applicableGates.length === 0) {
    throw new Error(
      "No applicable gates for this package type — refusing to report ready with zero gates."
    );
  }
  const gates = {};
  const blocking = [];
  for (const gate of applicableGates) {
    assertGate(gate);
    const result = isGateSatisfied(getGateState(gate));
    gates[gate] = result;
    if (!result.satisfied) blocking.push(gate);
  }
  return { ready: blocking.length === 0, gates, blocking };
}

/**
 * Validate an override request before it reaches the database.
 * Pure checks; the DB trigger stamps the actor and enforces expiry > created.
 */
export function validateOverride({ gate, reason, expiresAt, nowIso }) {
  assertGate(gate);
  if (!reason || !reason.trim()) {
    throw new Error("An override requires a reason.");
  }
  const expires = new Date(expiresAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(expires) || expires <= now) {
    throw new Error("Override expiry must be in the future.");
  }
  // Overrides are human decisions with a shelf life: cap at 30 days so a
  // forgotten override cannot silently govern readiness indefinitely.
  const maxMs = 30 * 24 * 60 * 60 * 1000;
  if (expires - now > maxMs) {
    throw new Error("Override expiry cannot exceed 30 days.");
  }
}
