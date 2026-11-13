// Work Package Planner — planning-process steps (Josh's Packaged
// Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20).
//
// The PDF is the ONLY source for the checklist: 22 numbered steps, 11
// weighted earning progress (credits sum 100%, 40 MHRS standard), 11
// reporting-only at 0%/0h, five word statuses, complexity scale Low 75%
// / Standard 100% / Mid 150% / High 200% / H-High 300%. The GUIDANCE
// 21-step list and the KR 20-step rollup are REFERENCE ONLY — nothing
// in this module comes from them.
//
// Scope-review verdict (ChatGPT, 2026-11-12 — NEEDS CHANGES, core model
// accepted) applied here:
//   F1: planningPercent / earnedPlanningHours are planning progress
//      ONLY — never construction readiness, never an IFC release.
//      CONSTRUCTION_READINESS_NOT_ESTABLISHED is the single source
//      for the not-established wording the UI shows at 100%.
//   F2: the transition rules (evidence / reason / attestation /
//      self-review) live here as the shared plain-words pre-check for
//      the UI; the set-status RPC is the enforcement.
//   F3: the template is versioned and immutable — 22 stable PDF step
//      keys (pdf-01 … pdf-22), version 1. Progress is computed against
//      the FIXED denominator 100 and FAILS CLOSED on a missing or
//      duplicated instance row.
//   F4: "Weighted Value" is earned planning MHRS / total planned
//      planning MHRS — never cost EV, construction EV or actual
//      labor hours.
//
// This module is the single source of truth for earned value: percent
// complete is ALWAYS the weighted sum of earned steps, computed here
// from template credits + instance statuses. It is never typed in, never
// stored, and never recomputed anywhere else — the checklist RPC returns
// raw rows, the UI and the dashboard both call computePlanningProgress.
// Credits summing to 100% is validated here, not assumed: a template
// that cannot reach 100% throws instead of reporting a wrong number.

export const PLANNING_PROCESS_TEMPLATE_VERSION = 1;

// The 22 steps, PDF order, PDF numbering kept (do not renumber the 11
// weighted rows as 1–11). Weighted steps: 1, 2, 3, 4, 5, 7, 9, 11, 14,
// 15, 18 — weights 5, 5, 5, 10, 10, 10, 10, 10, 10, 15, 10; standard
// MHRS 2, 2, 2, 4, 4, 4, 4, 4, 4, 6, 4. Reporting-only: 6, 8, 10, 12,
// 13, 16, 17, 19, 20, 21, 22 at 0% / 0h. Step keys are stable across
// template versions; a future version adds new rows, never edits these.
export const PLANNING_PROCESS_TEMPLATE = Object.freeze([
  Object.freeze({ stepKey: "pdf-01", stepNumber: 1, name: "P & I.D. / MFD", role: "Planning", creditPct: 5, mhrsStandard: 2, description: "P&ID marked up by the planner to identify specific scope." }),
  Object.freeze({ stepKey: "pdf-02", stepNumber: 2, name: "Plot Plan", role: "Planning", creditPct: 5, mhrsStandard: 2, description: "Plot plan marked up with physical location and approximate elevation, for planning purposes only." }),
  Object.freeze({ stepKey: "pdf-03", stepNumber: 3, name: "Planning Photo's", role: "Planning", creditPct: 5, mhrsStandard: 2, description: "Single scope item, photo marked up clearly; insulation removed to identify scope." }),
  Object.freeze({ stepKey: "pdf-04", stepNumber: 4, name: "Equip. Details/Dwgs", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "Relevant data and drawings for the scope: specs, vendor data, cut sheet, pipe spec, existing ISOs." }),
  Object.freeze({ stepKey: "pdf-05", stepNumber: 5, name: "Inspection Requirements", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "Inspection tab filled out as completely as possible; site inspection codes referenced." }),
  Object.freeze({ stepKey: "pdf-06", stepNumber: 6, name: "Engineering Request", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Documentation gathered and submitted through the engineering request process; N/A if not required." }),
  Object.freeze({ stepKey: "pdf-07", stepNumber: 7, name: "I.F.C. Drawings", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "Generated from the engineering request; planner attends drawing reviews (IFR, IFA, IFC) for constructibility, then uploads. A Complete here is planning progress only — it never authorizes construction or releases an IFC drawing." }),
  Object.freeze({ stepKey: "pdf-08", stepNumber: 8, name: "Work Blind List", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Primary planner develops the initial blind list; contractor performs final review." }),
  Object.freeze({ stepKey: "pdf-09", stepNumber: 9, name: "Material B.O.M.", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "Planner reviews and develops the initial list for long-lead identification and budgetary purposes; BOM submitted to Buyer." }),
  Object.freeze({ stepKey: "pdf-10", stepNumber: 10, name: "Material P.O.", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Planner or stakeholder approves the material PR once vendor selected, deliverables accepted, quote approved; procurement tracking begins." }),
  Object.freeze({ stepKey: "pdf-11", stepNumber: 11, name: "Lifting Equipment", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "Initial job walk completed; crane needs identified; planner and contractor agree; crane contractor walked the job if required." }),
  Object.freeze({ stepKey: "pdf-12", stepNumber: 12, name: "Scaffold Requisitions", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Planner and contractor agree on scaffold needs; scaffold contractor walked the job and received a requisition." }),
  Object.freeze({ stepKey: "pdf-13", stepNumber: 13, name: "Planning Support", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Compilation of miscellaneous data: insulation, abatement, steam trace, lead paint, crane needs." }),
  Object.freeze({ stepKey: "pdf-14", stepNumber: 14, name: "Safety Plan", role: "Planning", creditPct: 10, mhrsStandard: 4, description: "All hazards identified, mitigation developed and included in the execution plan." }),
  Object.freeze({ stepKey: "pdf-15", stepNumber: 15, name: "Job Plan Developed", role: "Planning", creditPct: 15, mhrsStandard: 6, description: "Detailed execution plan developed, submitted, and reviewed by the primary planner." }),
  Object.freeze({ stepKey: "pdf-16", stepNumber: 16, name: "Job Plan Integrated", role: "Planning", creditPct: 0, mhrsStandard: null, description: "Execution strategy reviewed by planner, contractor, master scheduler; density review and crew assignments." }),
  Object.freeze({ stepKey: "pdf-17", stepNumber: 17, name: "Operation Decon Plan", role: "Operation", creditPct: 0, mhrsStandard: null, description: "Process planner provides the scope safely; operations plans removal or minimization of hazards; plan loaded into the package." }),
  Object.freeze({ stepKey: "pdf-18", stepNumber: 18, name: "Operation LOTO", role: "Operation", creditPct: 10, mhrsStandard: 4, description: "Process planner develops the work-isolation blinding plan; confined-space isolations and ventilation captured; finished plans loaded into the package." }),
  Object.freeze({ stepKey: "pdf-19", stepNumber: 19, name: "Operations Review", role: "Operation", creditPct: 0, mhrsStandard: null, description: "Primary planner final approval and buy-in by primary stakeholders and unit operations." }),
  Object.freeze({ stepKey: "pdf-20", stepNumber: 20, name: "Engineer Repair Plan", role: "Operation", creditPct: 0, mhrsStandard: null, description: "Process-equipment repair plans generated by a mechanical engineer when modifying or repairing existing equipment." }),
  Object.freeze({ stepKey: "pdf-21", stepNumber: 21, name: "Engineer M-Spec", role: "Operation", creditPct: 0, mhrsStandard: null, description: "Process equipment requiring new or replacement parts verified by a qualified representative; documentation issued through document control." }),
  Object.freeze({ stepKey: "pdf-22", stepNumber: 22, name: "MOC Ready", role: "Operation", creditPct: 0, mhrsStandard: null, description: "Scope requiring an MOC identified early; MOC requested from the primary stakeholder; complete once the MOC is approved for implementation." }),
]);

// F1: construction readiness is a separate output from planning
// percent, derived from actual package/revision/operations gates —
// never from planningPercent, Reviewed, N/A or the 0%-weight rows.
// No package-level release decision exists in Slice A and no release
// API is invented, so readiness is always not-established here; the
// UI shows this sentence whenever planning reaches 100%.
export const CONSTRUCTION_READINESS_NOT_ESTABLISHED = Object.freeze({
  status: "not_established",
  detail: "No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.",
});

export const PLANNING_PROCESS_STATUSES = Object.freeze([
  Object.freeze({ value: "In-Progress", earnsValue: false, label: "In-Progress" }),
  Object.freeze({ value: "Complete", earnsValue: true, label: "Complete" }),
  Object.freeze({ value: "N/A", earnsValue: true, label: "N/A" }),
  Object.freeze({ value: "Reviewed", earnsValue: true, label: "Reviewed" }),
  Object.freeze({ value: "Needs Revision", earnsValue: false, label: "Needs Revision" }),
]);

export const PLANNING_PROCESS_STATUS_VALUES = Object.freeze(
  PLANNING_PROCESS_STATUSES.map((s) => s.value),
);

// Statuses that earn their credit (PDF Rules of Progression): N/A and
// Complete progress as completed; Reviewed is accepted by the reviewer;
// In-Progress and Needs Revision earn nothing. Pending is NOT a status:
// the PDF's five deliberately exclude it — a pending step is not
// approved for work and earns nothing.
export const EARNING_STATUSES = Object.freeze(["N/A", "Complete", "Reviewed"]);

export function statusEarnsValue(status) {
  return EARNING_STATUSES.includes(status);
}

export const PLANNING_PROCESS_COMPLEXITIES = Object.freeze([
  Object.freeze({ key: "low", label: "Low", multiplier: 0.75, standardMhrs: 30 }),
  Object.freeze({ key: "standard", label: "Standard", multiplier: 1, standardMhrs: 40 }),
  Object.freeze({ key: "mid", label: "Mid", multiplier: 1.5, standardMhrs: 60 }),
  Object.freeze({ key: "high", label: "High", multiplier: 2, standardMhrs: 80 }),
  Object.freeze({ key: "h_high", label: "H-High", multiplier: 3, standardMhrs: 120 }),
]);

export const PLANNING_PROCESS_COMPLEXITY_KEYS = Object.freeze(
  PLANNING_PROCESS_COMPLEXITIES.map((c) => c.key),
);

export function complexityMultiplier(complexity) {
  const found = PLANNING_PROCESS_COMPLEXITIES.find((c) => c.key === complexity);
  return found ? found.multiplier : null;
}

export function complexityLabel(complexity) {
  const found = PLANNING_PROCESS_COMPLEXITIES.find((c) => c.key === complexity);
  return found ? found.label : complexity || "—";
}

// Per-step MHRS at a package's complexity: template MHRS x multiplier.
// Reporting-only steps carry no hours (null in, null out). Never
// overridden per step — decision 3.
export function scaledMhrs(mhrsStandard, complexity) {
  if (mhrsStandard == null) return null;
  const multiplier = complexityMultiplier(complexity);
  if (multiplier == null) return null;
  return Math.round(Number(mhrsStandard) * multiplier * 100) / 100;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Validates the template the progress is computed from: exactly the
// PDF's 22 steps, 22 distinct stable step keys, step numbers 1–22,
// credits summing to exactly 100, standard hours to exactly 40. The
// migration asserts the same at apply time; this is the runtime
// backstop so a wrong template can never silently report a percent
// complete that cannot reach 100.
export function validatePlanningTemplate(template) {
  const rows = Array.isArray(template) ? template : [];
  if (rows.length !== 22) {
    return { ok: false, error: `Planning-process template must have 22 steps, found ${rows.length}.` };
  }
  const keys = new Set(rows.map((row) => row.stepKey));
  if (keys.size !== 22) {
    return { ok: false, error: `Planning-process template must have 22 distinct step keys, found ${keys.size}.` };
  }
  const numbers = rows.map((row) => row.stepNumber).sort((a, b) => a - b);
  for (let i = 0; i < 22; i += 1) {
    if (numbers[i] !== i + 1) {
      return { ok: false, error: `Planning-process template step numbers must be 1–22 in PDF order.` };
    }
  }
  const totalCredit = round2(rows.reduce((sum, row) => sum + Number(row.creditPct || 0), 0));
  if (totalCredit !== 100) {
    return { ok: false, error: `Planning-process template credits must sum to 100, found ${totalCredit}.` };
  }
  const totalHours = round2(rows.reduce((sum, row) => sum + Number(row.mhrsStandard || 0), 0));
  if (totalHours !== 40) {
    return { ok: false, error: `Planning-process template standard hours must sum to 40, found ${totalHours}.` };
  }
  return { ok: true, totalCredit, totalHours };
}

// Percent complete = weighted sum of earned steps (credit % of steps in
// N/A / Complete / Reviewed) against the FIXED denominator 100.
// Reporting-only steps carry 0% credit, so they move the count but
// never the percent. `template` rows carry { stepKey, creditPct,
// mhrsStandard }; `instances` carry { templateStepId, status }.
// Fails closed: zero instances is "not started" (initialized: false,
// 0% — the summary path's honest empty state); a PARTIAL instance set
// (some rows, not 22) or a duplicated step throws instead of reporting
// a percent that cannot be trusted.
export function computePlanningProgress({ template, instances, complexity }) {
  const templateCheck = validatePlanningTemplate(template);
  if (!templateCheck.ok) throw new Error(templateCheck.error);
  const multiplier = complexityMultiplier(complexity);
  if (multiplier == null) {
    throw new Error(`Unknown planning complexity: ${complexity}.`);
  }
  const list = Array.isArray(instances) ? instances : [];
  const stepsByStatus = {};
  for (const status of PLANNING_PROCESS_STATUS_VALUES) stepsByStatus[status] = 0;
  const totalMhrs = round2(
    template.reduce((sum, row) => sum + scaledMhrs(row.mhrsStandard, complexity), 0),
  );
  if (list.length === 0) {
    return {
      percentComplete: 0,
      earnedCreditPct: 0,
      totalCreditPct: 100,
      earnedMhrs: 0,
      totalMhrs,
      stepsTotal: 22,
      stepsEarned: 0,
      stepsByStatus,
      initialized: false,
    };
  }
  if (list.length !== 22) {
    throw new Error(`Planning-process checklist is incomplete: expected 22 instance rows, found ${list.length}.`);
  }
  const seen = new Set();
  for (const instance of list) {
    if (seen.has(instance.templateStepId)) {
      throw new Error(`Planning-process checklist is invalid: duplicated instance for step ${instance.templateStepId}.`);
    }
    seen.add(instance.templateStepId);
  }
  const byKey = new Map(template.map((row) => [row.stepKey, row]));
  for (const key of seen) {
    if (!byKey.has(key)) {
      throw new Error(`Planning-process checklist is invalid: instance for unknown step ${key}.`);
    }
  }
  let earnedCredit = 0;
  let earnedMhrs = 0;
  let stepsEarned = 0;
  for (const instance of list) {
    const step = byKey.get(instance.templateStepId);
    const status = instance.status;
    if (stepsByStatus[status] !== undefined) stepsByStatus[status] += 1;
    if (!statusEarnsValue(status)) continue;
    stepsEarned += 1;
    earnedCredit = round2(earnedCredit + Number(step.creditPct || 0));
    earnedMhrs = round2(earnedMhrs + scaledMhrs(step.mhrsStandard, complexity));
  }
  const percentComplete = round2((earnedCredit / 100) * 100);
  return {
    percentComplete,
    earnedCreditPct: earnedCredit,
    totalCreditPct: 100,
    earnedMhrs,
    totalMhrs,
    stepsTotal: 22,
    stepsEarned,
    stepsByStatus,
    initialized: true,
  };
}

// F2 transition rules, as a shared plain-words pre-check for the UI
// (the set-status RPC is the enforcement — this never authorizes
// anything on its own).
//
// Inputs the UI has: the target status, the caller's affordances
// (canUpdate/canReview from the checklist), the row's current status
// and stored evidence link, the change the user typed (new evidence
// link, reason, attestation), and whether the caller submitted this
// row's latest change (instance.submittedBy === the caller's user id
// — the UI knows its user only via the checklist's submittedBy vs the
// actor it cannot see, so callers pass isSelfSubmission only when
// they can prove it; otherwise the RPC decides and returns 403).
//
// Returns an error string, or null when the change is allowed to be
// attempted. A null here is NOT an authorization — the RPC re-checks
// everything server-side.
export function validatePlanningStatusChange({
  status, canUpdate, canReview,
  oldStatus, storedEvidenceLink, newEvidenceLink, reason, attestation,
  isSelfSubmission = false, isOwner = false,
}) {
  if (!PLANNING_PROCESS_STATUS_VALUES.includes(status)) {
    return `Status must be one of: ${PLANNING_PROCESS_STATUS_VALUES.join(", ")}.`;
  }
  const reasonCheck = validateReason(reason, { required: status === "N/A" || status === "Needs Revision" });
  if (!reasonCheck.ok) return reasonCheck.error;
  const attestationCheck = validateAttestation(attestation);
  if (!attestationCheck.ok) return attestationCheck.error;
  if (status === "Reviewed") {
    if (!canReview) return "Only a reviewer can mark a step Reviewed.";
    if (isSelfSubmission && !isOwner) {
      return "You submitted this step's latest change — a different reviewer must review it.";
    }
    if (isSelfSubmission && isOwner && !reasonCheck.value) {
      return "An owner override reviewing your own submission needs a reason.";
    }
    if (oldStatus === "Needs Revision" && !hasFreshEvidence({ newEvidenceLink, attestation })) {
      return "Returning this step from Needs Revision needs fresh evidence or an attestation.";
    }
    return null;
  }
  if (!canUpdate) return "You don't have permission to change planning-process steps.";
  if (status === "Complete") {
    if (oldStatus === "Needs Revision") {
      if (!hasFreshEvidence({ newEvidenceLink, attestation })) {
        return "Returning this step from Needs Revision needs fresh evidence or an attestation.";
      }
    } else {
      const effectiveEvidence = newEvidenceLink === "" ? null : (newEvidenceLink ?? storedEvidenceLink ?? null);
      if (!effectiveEvidence && !attestationCheck.value) {
        return "Marking a step Complete needs an evidence link or a completion attestation.";
      }
    }
    return null;
  }
  if (status === "N/A" || status === "Needs Revision") {
    if (!reasonCheck.value) {
      return status === "N/A"
        ? "Marking a step N/A needs a reason."
        : "Sending a step back for revision needs a reason.";
    }
    return null;
  }
  return null;
}

// Fresh evidence for a return from Needs Revision: a link or an
// attestation supplied in THIS request — a link already stored on the
// row is stale and does not count.
export function hasFreshEvidence({ newEvidenceLink, attestation }) {
  const link = typeof newEvidenceLink === "string" ? newEvidenceLink.trim() : "";
  const note = typeof attestation === "string" ? attestation.trim() : "";
  return link.length > 0 || note.length > 0;
}

export function validateReason(value, { required = false } = {}) {
  if (value == null || String(value).trim().length === 0) {
    if (required) return { ok: false, error: "A reason is required for this change.", value: null };
    return { ok: true, value: null };
  }
  const trimmed = String(value).trim();
  if (trimmed.length > 500) return { ok: false, error: "Reason must be 500 characters or fewer.", value: null };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, error: "Reason must not contain control characters.", value: null };
  }
  return { ok: true, value: trimmed };
}

export function validateAttestation(value) {
  if (value == null || String(value).trim().length === 0) return { ok: true, value: null };
  const trimmed = String(value).trim();
  if (trimmed.length > 500) return { ok: false, error: "Completion attestation must be 500 characters or fewer.", value: null };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, error: "Completion attestation must not contain control characters.", value: null };
  }
  return { ok: true, value: trimmed };
}

export function validateEvidenceLink(value) {
  if (value == null || value === "") return { ok: true, value: null };
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 2000) return { ok: false, error: "Evidence link must be 2,000 characters or fewer." };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, error: "Evidence link must not contain control characters." };
  }
  return { ok: true, value: trimmed };
}
