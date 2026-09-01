// Deterministic readiness waiting (FB-UI-1 requirement 5: "Wait deterministically for fonts, charts,
// loading states, and approved readiness markers"). A readiness *plan* is pure data -- built here
// without touching a browser, independently testable -- and a separate executor consumes a plan
// against a real (or mocked) Playwright `page`. Every condition has an explicit, bounded timeout;
// there is no unconditional `waitForTimeout`-style sleep anywhere in this module, since a fixed
// sleep is neither deterministic (it either finishes too early under load or wastes time when the
// page is already ready) nor closable to a specific fail reason.

export const READINESS_CONDITION_TYPES = Object.freeze({
  FONTS: "fonts",
  NETWORK_IDLE: "network-idle",
  NO_LOADING_STATUS: "no-loading-status",
  CUSTOM_MARKER: "custom-marker",
});

const DEFAULT_TIMEOUT_MS = 10_000;

// Every route gets these two conditions for free, in this fixed order, before any route-specific
// marker: page fonts must finish loading (so text-reflow doesn't shift layout mid-capture) and the
// network must go idle (so a chart or KPI panel that fetches its own data after initial paint has
// had a chance to resolve). Route-specific conditions (a "no loading text" check, or a named
// `data-fb-ui-ready` marker a component opts into) are appended after these two, in the order the
// route definition lists them -- deterministic because the order is never re-sorted by this module.
export function buildReadinessPlan(route) {
  if (!route || typeof route !== "object") throw new Error("buildReadinessPlan requires a route definition");
  const conditions = [
    { type: READINESS_CONDITION_TYPES.FONTS, description: "document.fonts.ready", timeoutMs: DEFAULT_TIMEOUT_MS },
    { type: READINESS_CONDITION_TYPES.NETWORK_IDLE, description: "network idle", timeoutMs: DEFAULT_TIMEOUT_MS },
  ];
  for (const marker of route.readinessMarkers || []) {
    if (marker.type === READINESS_CONDITION_TYPES.NO_LOADING_STATUS) {
      conditions.push({
        type: READINESS_CONDITION_TYPES.NO_LOADING_STATUS,
        description: 'no [role="status"] element contains loading-like text',
        timeoutMs: marker.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
    } else if (marker.type === READINESS_CONDITION_TYPES.CUSTOM_MARKER) {
      if (!marker.selector) throw new Error(`custom-marker readiness condition on route "${route.routeId}" is missing a selector`);
      conditions.push({
        type: READINESS_CONDITION_TYPES.CUSTOM_MARKER,
        description: `element matching "${marker.selector}" is present`,
        selector: marker.selector,
        timeoutMs: marker.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
    } else {
      throw new Error(`Unknown readiness marker type "${marker.type}" on route "${route.routeId}"`);
    }
  }
  return Object.freeze(conditions.map((condition) => Object.freeze(condition)));
}

export class ReadinessTimeoutError extends Error {
  constructor(condition, cause) {
    super(`Readiness condition "${condition.description}" did not resolve within ${condition.timeoutMs}ms`);
    this.name = "ReadinessTimeoutError";
    this.condition = condition;
    this.cause = cause;
  }
}

// Executes a plan against a Playwright `page`-shaped object in order, stopping (fail-closed) at the
// first condition that doesn't resolve in time, rather than racing all conditions or swallowing a
// timeout to "best effort" continue. Returns the ordered evidence array for a satisfied plan --
// this is exactly what the manifest's `readinessEvidence` field stores (FB-UI-1 requirement 7).
export async function waitForReadiness(page, plan) {
  const evidence = [];
  for (const condition of plan) {
    const startedAt = Date.now();
    try {
      await runCondition(page, condition);
    } catch (cause) {
      throw new ReadinessTimeoutError(condition, cause);
    }
    evidence.push(Object.freeze({ type: condition.type, description: condition.description, satisfied: true, waitedMs: Date.now() - startedAt }));
  }
  return Object.freeze(evidence);
}

// Playwright's page.evaluate() has no timeout option of its own (unlike waitForLoadState/
// waitForFunction/waitForSelector, which all accept one natively) -- a manual race is the only way to
// bound how long the FONTS condition can wait, so it fails closed with the same ReadinessTimeoutError
// shape as every other condition instead of hanging indefinitely if document.fonts.ready never settles.
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function runCondition(page, condition) {
  switch (condition.type) {
    case READINESS_CONDITION_TYPES.FONTS:
      return withTimeout(page.evaluate(() => document.fonts.ready), condition.timeoutMs);
    case READINESS_CONDITION_TYPES.NETWORK_IDLE:
      return page.waitForLoadState("networkidle", { timeout: condition.timeoutMs });
    case READINESS_CONDITION_TYPES.NO_LOADING_STATUS:
      return page.waitForFunction(
        () => ![...document.querySelectorAll('[role="status"]')].some((el) => /loading/i.test(el.textContent || "")),
        null,
        { timeout: condition.timeoutMs },
      );
    case READINESS_CONDITION_TYPES.CUSTOM_MARKER:
      return page.waitForSelector(condition.selector, { timeout: condition.timeoutMs, state: "attached" });
    default:
      throw new Error(`Unknown readiness condition type "${condition.type}"`);
  }
}
