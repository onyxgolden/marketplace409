// Breakpoint-regression rule: the only rule in this checkpoint that needs more than one viewport's
// diagnostics snapshot at once, since a regression is defined by comparing the *same* route across
// desktop/tablet/mobile, not by anything visible in a single capture. `context.snapshotsByViewport`
// (desktop/tablet/mobile UiDiagnosticsSnapshot, all for the same route) is required in addition to
// the single-viewport fields every other rule in this directory uses.

import { FINDING_CATEGORY, FINDING_CLASS, FINDING_CONFIDENCE, FINDING_SEVERITY, PROPOSAL_STATUS } from "./findingContracts.mjs";

function visibleInteractiveAccessibleNames(snapshot) {
  return new Set(
    snapshot.elements
      .filter((el) => el.isInteractive && el.visible && el.accessibleName)
      .map((el) => el.accessibleName),
  );
}

// A control that survives the desktop -> tablet step down but disappears entirely at mobile is a
// stronger signal of an unintentional cutoff than a control that's merely absent at *some* narrower
// viewport (which responsive design legitimately does on purpose all the time, e.g. collapsing a
// secondary nav into a menu). Requiring presence at BOTH wider viewports before flagging its absence
// at the narrowest is what keeps this rule's false-positive rate down -- reflected in its MEDIUM,
// never HIGH, confidence.
export function findBreakpointRegressions(context) {
  const { desktop, tablet, mobile } = context.snapshotsByViewport || {};
  if (!desktop || !tablet || !mobile) return [];

  const desktopNames = visibleInteractiveAccessibleNames(desktop);
  const tabletNames = visibleInteractiveAccessibleNames(tablet);
  const mobileNames = visibleInteractiveAccessibleNames(mobile);

  const vanishedAtMobile = [...desktopNames].filter((name) => tabletNames.has(name) && !mobileNames.has(name));

  return vanishedAtMobile.map((name) => ({
    findingClass: FINDING_CLASS.DETERMINISTIC, application: context.application, routeId: context.routeId,
    routePath: context.routePath, viewport: "mobile", screenshotHash: context.screenshotHashByViewport.mobile,
    status: PROPOSAL_STATUS.NEW,
    ruleId: "breakpoint-regression", category: FINDING_CATEGORY.BREAKPOINT_REGRESSION,
    severity: FINDING_SEVERITY.HIGH, confidence: FINDING_CONFIDENCE.MEDIUM,
    probableSourceFiles: [`(inspect the responsive/breakpoint styles for the control named "${name}")`],
    affectedComponent: name,
    explanation: `The control "${name}" is present and visible at the desktop and tablet viewports but is not present (or not visible) at mobile -- this is more likely an unintentional layout cutoff than deliberate responsive hiding, since it survives the first breakpoint step down.`,
    proposedImprovement: "Confirm whether hiding this control on mobile is intentional. If not, adjust the responsive layout/breakpoint styles so it remains visible and usable at the mobile viewport.",
    validationRequirements: ["Re-capture screenshot evidence at all three viewports and confirm the control is present at mobile (or confirm with the owner that hiding it is intentional)", "If kept hidden intentionally, confirm an equivalent action is reachable another way on mobile"],
    prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
    rollbackDescription: "Revert the responsive/breakpoint style change; no data or schema is touched.",
  }));
}
