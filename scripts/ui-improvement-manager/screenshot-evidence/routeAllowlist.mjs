// Explicit approved-route list (FB-UI-1 requirement 3). A closed array, not a pattern/glob -- exactly
// the same "closed allowlist, nothing registers itself" shape as
// src/application/developer/ProgrammerCommandRegistry.js. Adding a route requires editing this file
// and passing review, the same way adding a developer command does; a UI Improvement Manager cannot
// expand its own reach by discovering new routes at runtime.
//
// Seeded minimally for FB-UI-1 ("smallest deterministic foundation"): one public, no-auth route to
// prove the foundation end-to-end without any preview-session dependency, and one authenticated route
// with a real readiness marker and one named component target, to prove those code paths against
// something realistic rather than only a trivial page. Both are real, currently-live FORGE routes.
//
// `data-fb-ui-ready` (used below by /forge/financial's readiness marker) is a NEW convention this
// checkpoint proposes, not yet adopted anywhere in the application -- see the FB-UI-1 report. Until a
// component opts in, that custom-marker condition will simply time out and fail closed, which is the
// correct behavior for an unverified readiness signal (never silently skipped).

import { READINESS_CONDITION_TYPES } from "./readinessWait.mjs";

export const APPROVED_ROUTES = Object.freeze([
  Object.freeze({
    routeId: "home",
    path: "/",
    requiresAuth: false,
    label: "409 Marketplace home page",
    readinessMarkers: Object.freeze([]),
    components: Object.freeze([]),
  }),
  Object.freeze({
    routeId: "forge-financial-overview",
    path: "/forge/financial",
    requiresAuth: true,
    label: "FORGE Financial Overview tab",
    readinessMarkers: Object.freeze([
      Object.freeze({ type: READINESS_CONDITION_TYPES.NO_LOADING_STATUS }),
      Object.freeze({ type: READINESS_CONDITION_TYPES.CUSTOM_MARKER, selector: "[data-fb-ui-ready]" }),
    ]),
    components: Object.freeze([
      Object.freeze({ name: "account-balances-tree", selector: '[data-fb-ui-component="account-balances-tree"]' }),
      Object.freeze({ name: "expense-categories-donut", selector: '[data-fb-ui-component="expense-categories-donut"]' }),
    ]),
  }),
]);

export class RouteNotApprovedError extends Error {
  constructor(path) {
    super(`Route "${path}" is not on the FB-UI approved route list`);
    this.name = "RouteNotApprovedError";
    this.path = path;
  }
}

export function findApprovedRoute(path) {
  return APPROVED_ROUTES.find((route) => route.path === path) || null;
}

// Throws (fail-closed) rather than returning null -- see hostAllowlist.mjs's assertHostPermitted for
// the same rationale: capture code must not be able to silently proceed with an unapproved route by
// forgetting to check a nullable return value.
export function assertRouteApproved(path) {
  const route = findApprovedRoute(path);
  if (!route) throw new RouteNotApprovedError(path);
  return route;
}
