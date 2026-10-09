// FORGE Work Management — Work Package domain (Rung 1).
//
// Pure, deterministic domain logic: no DB, no network, no Date.now().
// All functions are total and side-effect free so they unit-test cleanly.
// Implements docs/forge-work-management/work-package-domain.md and
// docs/forge-work-management/lifecycle.md.

import {
  normalizePlannedCostCents,
  parsePlannedBudgetToCents,
} from "./packageCosts.js";

export const WP_STATUS = Object.freeze({
  DRAFT: "draft",
  PLANNED: "planned",
  READINESS_REVIEW: "readiness_review",
  READY: "ready",
  IN_PROGRESS: "in_progress",
  BLOCKED: "blocked",
  COMPLETE: "complete",
  VERIFIED_CLOSED: "verified_closed",
  CANCELLED: "cancelled",
});

export const WP_PACKAGE_TYPES = Object.freeze([
  "remodel", "rental_turn", "maintenance_repair", "new_construction_phase",
  "engineering", "industrial", "capital_project", "other",
]);

export const WP_PRIORITIES = Object.freeze(["low", "normal", "high", "critical"]);

export const WP_PROGRESS_BASES = Object.freeze([
  "quantity", "manhours", "milestone_weights", "manual",
]);

// The 12 readiness gates. Rung 1 ships the default set per package_type;
// the Rung 3 engine evaluates them. Gate state is never derived here.
export const WP_GATES = Object.freeze([
  "scope", "design", "predecessor", "material", "crew", "permit", "site",
  "safety", "evidence", "equipment_readiness", "inspection_prerequisite",
  "logistics",
]);

const BASE_GATES = ["scope", "crew", "safety"];
const BUILD_GATES = ["design", "material", "permit", "site", "evidence"];

// Default gate set per package_type (readiness-model.md: Rung 1 ships a
// default set; per-gate N/A attestation is always available).
export function defaultGatesFor(packageType) {
  switch (packageType) {
    case "industrial":
    case "capital_project":
      return [...BASE_GATES, ...BUILD_GATES, "predecessor",
        "equipment_readiness", "inspection_prerequisite", "logistics"];
    case "new_construction_phase":
      return [...BASE_GATES, ...BUILD_GATES, "predecessor"];
    case "remodel":
    case "rental_turn":
    case "maintenance_repair":
      return [...BASE_GATES, ...BUILD_GATES];
    case "engineering":
      return ["scope", "design", "crew", "evidence", "safety"];
    case "other":
    default:
      return [...BASE_GATES];
  }
}

export function isTerminalStatus(status) {
  return status === WP_STATUS.VERIFIED_CLOSED || status === WP_STATUS.CANCELLED;
}

// States from which Blocked may be entered. Leaving Blocked returns to
// exactly blocked_from, never forward.
const BLOCKABLE_FROM = [
  WP_STATUS.DRAFT, WP_STATUS.PLANNED, WP_STATUS.READINESS_REVIEW,
  WP_STATUS.READY, WP_STATUS.IN_PROGRESS,
];

// Transition matrix: each row is { from, to, requires[], effects{} }.
// "Blocked -> blocked_from" and "Complete -> In Progress (rework)" are
// handled as special rows because their target/conditions are dynamic.
function staticTransitionRows() {
  const needs = (list) => list;
  return [
    { from: WP_STATUS.DRAFT, to: WP_STATUS.PLANNED,
      requires: needs(["title", "package_type", "planned_dates", "responsible_party"]),
      effects: {} },
    { from: WP_STATUS.PLANNED, to: WP_STATUS.READINESS_REVIEW,
      requires: needs(["scope_present"]),
      effects: {} },
    { from: WP_STATUS.READINESS_REVIEW, to: WP_STATUS.READY,
      requires: needs(["all_applicable_gates_ready"]),
      effects: {} },
    { from: WP_STATUS.READY, to: WP_STATUS.IN_PROGRESS,
      requires: needs(["user_confirmed_start"]),
      effects: { setActualStart: true } },
    ...BLOCKABLE_FROM.map((from) => ({
      from, to: WP_STATUS.BLOCKED,
      requires: needs(["blocked_reason", "blocked_source"]),
      effects: { recordBlockedFrom: from },
    })),
    { from: WP_STATUS.IN_PROGRESS, to: WP_STATUS.COMPLETE,
      requires: needs(["completion_basis"]),
      effects: { setActualFinish: true } },
    { from: WP_STATUS.COMPLETE, to: WP_STATUS.VERIFIED_CLOSED,
      requires: needs(["completion_criteria", "required_evidence", "verifier"]),
      effects: { setVerified: true } },
    // Verification rejected -> rework. Clears actual_finish: the work is no
    // longer reported complete.
    { from: WP_STATUS.COMPLETE, to: WP_STATUS.IN_PROGRESS,
      requires: needs(["verifier", "rejection_reason"]),
      effects: { clearActualFinish: true } },
    // Audited reopen from terminal states. Never straight back to Complete.
    // Both reopen rows clear actual_finish (lifecycle.md): the package is no
    // longer reported complete once it returns to work.
    { from: WP_STATUS.VERIFIED_CLOSED, to: WP_STATUS.IN_PROGRESS,
      requires: needs(["reopen_authority", "reopen_reason"]),
      effects: { clearVerified: true, clearActualFinish: true } },
    { from: WP_STATUS.CANCELLED, to: WP_STATUS.DRAFT,
      requires: needs(["reopen_authority", "reopen_reason"]),
      effects: { clearActualFinish: true } },
  ];
}

// Dynamic rows evaluated against the package's current state.
function dynamicRows(pkg) {
  const rows = [];
  if (pkg.status === WP_STATUS.BLOCKED && pkg.blocked_from) {
    rows.push({ from: WP_STATUS.BLOCKED, to: pkg.blocked_from,
      requires: ["blocker_cleared_or_override"], effects: { returnFromBlocked: true } });
  }
  // any non-terminal -> Cancelled
  if (!isTerminalStatus(pkg.status)) {
    rows.push({ from: pkg.status, to: WP_STATUS.CANCELLED,
      requires: ["cancel_reason"], effects: {} });
  }
  return rows;
}

// Static transition edges as [from, to] pairs. The migration seeds the same
// edges into forge_work_lifecycle_transitions so the RPC enforces the graph
// for direct callers; the parity test asserts the two can never drift.
export function staticTransitionEdges() {
  return staticTransitionRows().map((r) => [r.from, r.to]);
}

export function findTransition(pkg, to) {
  const all = [...staticTransitionRows(), ...dynamicRows(pkg)];
  return all.find((r) => r.from === pkg.status && r.to === to) || null;
}

// Every legal target status from the package's current state, including the
// dynamic rows (return-from-Blocked to blocked_from, Cancelled from any
// non-terminal state). Drives the UI's transition buttons.
export function allowedTransitionsFrom(pkg) {
  const rows = [...staticTransitionRows(), ...dynamicRows(pkg)];
  return [...new Set(rows.filter((r) => r.from === pkg.status).map((r) => r.to))];
}

// Validate a transition's requirements against the package + context.
// ctx: { attestationsByGate, evidenceHealth, completionCriteria, ... }
// Returns { ok: true, effects } or { ok: false, error }.
export function validateTransition(pkg, to, ctx = {}) {
  const row = findTransition(pkg, to);
  if (!row) {
    return { ok: false, error: `Illegal transition: ${pkg.status} -> ${to}.` };
  }
  const missing = [];
  for (const req of row.requires) {
    if (!requirementSatisfied(req, pkg, ctx)) missing.push(req);
  }
  if (missing.length > 0) {
    return { ok: false, error: `Transition ${pkg.status} -> ${to} missing: ${missing.join(", ")}.` };
  }
  return { ok: true, effects: row.effects };
}

function requirementSatisfied(req, pkg, ctx) {
  switch (req) {
    case "title": return typeof pkg.title === "string" && pkg.title.trim().length > 0;
    case "package_type": return WP_PACKAGE_TYPES.includes(pkg.package_type);
    case "planned_dates": return Boolean(pkg.planned_start && pkg.planned_finish);
    case "responsible_party": return Boolean(pkg.responsible_party);
    case "scope_present":
      // lifecycle.md: scope text present for ALL packages; industrial and
      // capital packages additionally need a frozen baseline.
      if (typeof pkg.description !== "string" || pkg.description.trim().length === 0) {
        return false;
      }
      if (pkg.package_type === "industrial" || pkg.package_type === "capital_project") {
        return Boolean(pkg.scope_baseline_id);
      }
      return true;
    case "all_applicable_gates_ready": {
      // Interim rule (Rung 3 engine not shipped): gates are satisfied by
      // explicit human attestations recorded per gate. ctx.attestedGates is
      // the set of gate keys with a current attestation.
      const gates = defaultGatesFor(pkg.package_type);
      const attested = new Set(ctx.attestedGates || []);
      return gates.every((g) => attested.has(g));
    }
    case "user_confirmed_start": return ctx.userConfirmedStart === true;
    case "blocked_reason": return typeof ctx.blockedReason === "string" && ctx.blockedReason.trim().length > 0;
    case "blocked_source": return Boolean(ctx.blockedSource);
    case "blocker_cleared_or_override":
      return ctx.blockerCleared === true || ctx.overrideAuthorized === true;
    case "completion_basis": {
      // percent_complete = 100 on the package's basis, or an explicit
      // completion report WITH a reason (lifecycle.md: "explicit completion
      // report with reason"). A bare flag is not a report.
      if (ctx.explicitCompletionReport === true) {
        return typeof ctx.completionReason === "string" && ctx.completionReason.trim().length > 0;
      }
      const pct = derivePercentComplete(pkg);
      return pct === 100;
    }
    case "completion_criteria":
      // Interim rule (Rung 10 not shipped): package's recorded checklist +
      // linked evidence health.
      return ctx.completionCriteriaMet === true;
    case "required_evidence": return ctx.requiredEvidenceOk === true;
    case "verifier": return Boolean(ctx.verifier);
    case "rejection_reason":
      return typeof ctx.rejectionReason === "string" && ctx.rejectionReason.trim().length > 0;
    case "reopen_authority": return ctx.reopenAuthority === true;
    case "reopen_reason":
      return typeof ctx.reopenReason === "string" && ctx.reopenReason.trim().length > 0;
    case "cancel_reason":
      return typeof ctx.cancelReason === "string" && ctx.cancelReason.trim().length > 0;
    default: return false;
  }
}

// Percent complete: derived, never hand-set, always 0-100. null means
// unknown (cannot be computed) — never zero-by-default.
export function derivePercentComplete(pkg) {
  const basis = pkg.progress_basis;
  if (!basis) return null;
  if (basis === "quantity") {
    if (pkg.planned_qty == null || Number(pkg.planned_qty) <= 0) return null;
    if (!pkg.planned_unit) return null;
    if (pkg.earned_qty == null) return null;
    return clampRound((Number(pkg.earned_qty) / Number(pkg.planned_qty)) * 100);
  }
  if (basis === "manhours") {
    if (pkg.planned_manhours == null || Number(pkg.planned_manhours) <= 0) return null;
    if (pkg.earned_manhours == null) return null;
    return clampRound((Number(pkg.earned_manhours) / Number(pkg.planned_manhours)) * 100);
  }
  if (basis === "milestone_weights") {
    // ctx-free: milestones are recorded via progress_updated_by rule credit;
    // the stored percent_complete for this basis is rule-credited.
    return pkg.percent_complete == null ? null : clampRound(Number(pkg.percent_complete));
  }
  if (basis === "manual") {
    if (pkg.percent_complete == null) return null;
    return clampRound(Number(pkg.percent_complete));
  }
  return null;
}

function clampRound(n) {
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

// Deterministic input validation for create/edit. Returns { ok, errors[] }.
// ISO calendar date (YYYY-MM-DD): the shape the Postgres `date` columns
// accept. Anything else (including "") is rejected here as a 400 instead of
// reaching the database as SQLSTATE 22007 / a generic 500.
function isValidISODate(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function validatePackageInput(input, { isEdit = false } = {}) {
  const errors = [];
  if (!isEdit || input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      errors.push("title is required and must be non-blank.");
    }
  }
  if (input.package_type !== undefined && !WP_PACKAGE_TYPES.includes(input.package_type)) {
    errors.push(`package_type must be one of: ${WP_PACKAGE_TYPES.join(", ")}.`);
  }
  if (input.priority !== undefined && !WP_PRIORITIES.includes(input.priority)) {
    errors.push(`priority must be one of: ${WP_PRIORITIES.join(", ")}.`);
  }
  for (const field of ["planned_start", "planned_finish"]) {
    const value = input[field];
    if (value !== undefined && value !== null && !isValidISODate(value)) {
      errors.push(`${field} must be a valid date in YYYY-MM-DD format.`);
    }
  }
  if (isValidISODate(input.planned_start) && isValidISODate(input.planned_finish)
      && input.planned_finish < input.planned_start) {
    errors.push("planned_finish must be on or after planned_start.");
  }
  if (input.progress_basis !== undefined && input.progress_basis !== null &&
      !WP_PROGRESS_BASES.includes(input.progress_basis)) {
    errors.push(`progress_basis must be one of: ${WP_PROGRESS_BASES.join(", ")}.`);
  }
  // Earned quantities outside 0..planned are rejected at write time.
  if (input.earned_qty != null && input.planned_qty != null) {
    if (Number(input.earned_qty) < 0 || Number(input.earned_qty) > Number(input.planned_qty)) {
      errors.push("earned_qty must be within 0..planned_qty.");
    }
  }
  if (input.earned_manhours != null && input.planned_manhours != null) {
    if (Number(input.earned_manhours) < 0 || Number(input.earned_manhours) > Number(input.planned_manhours)) {
      errors.push("earned_manhours must be within 0..planned_manhours.");
    }
  }
  if (input.planned_cost_cents !== undefined) {
    const planned = normalizePlannedCostCents(input.planned_cost_cents);
    if (!planned.ok) errors.push(planned.error);
  }
  if (input.planned_budget !== undefined) {
    const planned = parsePlannedBudgetToCents(input.planned_budget);
    if (!planned.ok) errors.push(`planned budget ${planned.error}`);
  }
  // percent_complete is never hand-set on create/edit; it is derived or
  // rule-credited through the progress path. (A stored null carried through
  // a merged edit candidate is not hand-setting.)
  if (input.percent_complete !== undefined && input.percent_complete !== null) {
    errors.push("percent_complete is derived and cannot be set directly.");
  }
  if (input.status !== undefined) {
    errors.push("status changes go through the transition endpoint, not edit.");
  }
  if (input.code !== undefined) {
    errors.push("code is assigned by the per-owner sequence and cannot be set directly.");
  }
  return { ok: errors.length === 0, errors };
}

// Canonical membership hash for scope baselines: substitution is detected by
// hash change, not by count. Canonical form: sorted by key, fixed fields.
export function hashScopeMembership(membership) {
  const items = [...(membership || [])]
    .map((m) => ({ key: m.key || "", description: m.description || "",
      quantity: Number(m.quantity || 0), unit: m.unit || "" }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const canonical = JSON.stringify(items);
  let h1 = 0x811c9dc5, h2 = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + 31), 16777619);
  }
  return `fnv1a:${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

// Derive the current baseline: the row no other row's supersedes_id points
// to (head of the supersession chain). Returns the row or null.
export function deriveCurrentBaseline(baselines) {
  if (!baselines || baselines.length === 0) return null;
  const superseded = new Set(baselines.map((b) => b.supersedes_id).filter(Boolean));
  const heads = baselines.filter((b) => !superseded.has(b.id));
  heads.sort((a, b) => b.version - a.version);
  return heads[0] || null;
}
