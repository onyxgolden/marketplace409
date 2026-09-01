// Content-state rules: empty-state layout defects, loading/error states that don't communicate
// status, and charts whose labels/ranges/incomplete periods may mislead. All three depend on opt-in
// `data-fb-ui-*` markup conventions this checkpoint proposes (empty-state and chart markers) or on the
// existing `[role="status"]`/`[role="alert"]` convention readinessWait.mjs already relies on -- see
// layoutRules.mjs's spacing rule for the same honest "produces zero findings until adopted" note.

import { FINDING_CATEGORY, FINDING_CLASS, FINDING_CONFIDENCE, FINDING_SEVERITY, PROPOSAL_STATUS } from "./findingContracts.mjs";

function baseDraft(context, overrides) {
  return {
    findingClass: FINDING_CLASS.DETERMINISTIC, application: context.application, routeId: context.routeId,
    routePath: context.routePath, viewport: context.viewport, screenshotHash: context.screenshotHash,
    status: PROPOSAL_STATUS.NEW, ...overrides,
  };
}

export function findEmptyStateLayoutDefects(context) {
  return context.snapshot.emptyStateMarkers
    .filter((marker) => marker.isEmpty && marker.rect.width === 0 && marker.rect.height === 0)
    .map((marker) => baseDraft(context, {
      ruleId: "empty-state-layout-defect", category: FINDING_CATEGORY.EMPTY_STATE_LAYOUT_DEFECT,
      severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the empty-state branch of the component rendering "${marker.selector}")`], affectedComponent: marker.selector,
      explanation: `"${marker.selector}" is marked as an empty state but rendered with zero width and height -- nothing is actually shown to the user in this state (no "no data yet" message, no call to action), which reads as a broken page rather than an intentional empty state.`,
      proposedImprovement: "Render a visible empty-state message (what's missing and what the user can do about it) instead of nothing.",
      validationRequirements: ["Re-capture screenshot evidence for this state and confirm the empty-state container has non-zero size and visible content", "Confirm the message is accurate for this specific empty condition"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not invent claims about what data will appear or when"],
      rollbackDescription: "Revert the empty-state markup change; no data or schema is touched.",
    }));
}

export function findStatusCommunicationIssues(context) {
  return context.snapshot.statusMarkers
    .filter((marker) => !marker.text)
    .map((marker) => baseDraft(context, {
      ruleId: "loading-error-status-communication", category: FINDING_CATEGORY.LOADING_ERROR_STATUS_COMMUNICATION,
      severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the component rendering "${marker.selector}")`], affectedComponent: marker.selector,
      explanation: `"${marker.selector}" has role="${marker.role}" but no text content. A ${marker.role === "alert" ? "user relying on assistive technology gets no announcement of what went wrong" : "screen-reader user gets no announcement of what's loading or what state the page is in"} -- a purely visual spinner or icon communicates nothing to them.`,
      proposedImprovement: `Add visible, descriptive text inside this ${marker.role} region (e.g. "Loading account balances…" or the specific error message), not just an icon or spinner.`,
      validationRequirements: ["Re-capture screenshot evidence and confirm the region has non-empty, accurate text for this state", "Confirm a screen reader announces the new text when the region updates"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not invent a status message that doesn't reflect the real underlying state"],
      rollbackDescription: "Revert the status-text addition; no data or schema is touched.",
    }));
}

export function findMisleadingCharts(context) {
  const drafts = [];
  for (const marker of context.snapshot.chartMarkers) {
    if (!marker.hasRangeLabel) {
      drafts.push(baseDraft(context, {
        ruleId: "misleading-chart-no-range-label", category: FINDING_CATEGORY.MISLEADING_CHART,
        severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.MEDIUM,
        probableSourceFiles: [`(inspect the chart component rendering "${marker.selector}")`], affectedComponent: marker.selector,
        explanation: `The chart at "${marker.selector}" has no declared date/value range label. Without a visible range, a user can't tell what period or scale the chart actually covers, which can make a partial or cherry-picked view look like the full picture.`,
        proposedImprovement: "Add a visible label stating the exact range the chart covers (e.g. \"Jan 1 - Jun 30, 2026\" or \"Last 6 months\").",
        validationRequirements: ["Re-capture screenshot evidence and confirm the range label is visible and matches the actual queried data range", "Confirm the label updates correctly when the user changes the selected range"],
        prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not alter what data the chart actually queries -- labeling only"],
        rollbackDescription: "Revert the label addition; no data or schema is touched.",
      }));
    }
    if (marker.declaredIncomplete && !marker.communicatesIncomplete) {
      drafts.push(baseDraft(context, {
        ruleId: "misleading-chart-incomplete-period", category: FINDING_CATEGORY.MISLEADING_CHART,
        severity: FINDING_SEVERITY.HIGH, confidence: FINDING_CONFIDENCE.HIGH,
        probableSourceFiles: [`(inspect the chart component rendering "${marker.selector}")`], affectedComponent: marker.selector,
        explanation: `The chart at "${marker.selector}" is marked as covering an incomplete period (e.g. the current month-to-date), but nothing on the page tells the user that -- a partial period can look like a full one and mislead a user comparing it to prior, complete periods.`,
        proposedImprovement: "Add a visible note (e.g. \"Month to date -- incomplete\") whenever the displayed period is not yet complete.",
        validationRequirements: ["Re-capture screenshot evidence and confirm the incomplete-period note is visible whenever the underlying data is genuinely incomplete", "Confirm the note disappears once the period is actually complete"],
        prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not alter what data the chart actually queries -- labeling only"],
        rollbackDescription: "Revert the incomplete-period note addition; no data or schema is touched.",
      }));
    }
  }
  return drafts;
}
