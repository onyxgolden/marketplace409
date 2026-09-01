// Layout-defect rules: horizontal overflow, clipped/truncated controls, overlapping content,
// inconsistent spacing. Every rule is a pure function `(context) -> findingDraft[]` -- no I/O, no
// browser, fully unit-testable against a fixture UiDiagnosticsSnapshot. `context` is
// { snapshot, application, routeId, routePath, viewport, screenshotHash }; findingEngine.mjs assigns
// findingId/detectedAt/status and runs every draft through validateUiFinding.

import { FINDING_CATEGORY, FINDING_CLASS, FINDING_CONFIDENCE, FINDING_SEVERITY, PROPOSAL_STATUS } from "./findingContracts.mjs";

function baseDraft(context, overrides) {
  return {
    ruleId: overrides.ruleId, category: overrides.category, findingClass: FINDING_CLASS.DETERMINISTIC,
    application: context.application, routeId: context.routeId, routePath: context.routePath, viewport: context.viewport,
    screenshotHash: context.screenshotHash, status: PROPOSAL_STATUS.NEW,
    ...overrides,
  };
}

const OVERFLOW_TOLERANCE_PX = 1;

export function findHorizontalOverflow(context) {
  const { documentMetrics } = context.snapshot;
  if (documentMetrics.scrollWidth <= documentMetrics.clientWidth + OVERFLOW_TOLERANCE_PX) return [];
  const overflowPx = Math.round(documentMetrics.scrollWidth - documentMetrics.clientWidth);
  return [baseDraft(context, {
    ruleId: "horizontal-overflow", category: FINDING_CATEGORY.HORIZONTAL_OVERFLOW,
    severity: overflowPx > 100 ? FINDING_SEVERITY.HIGH : FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
    probableSourceFiles: ["(page-level layout -- inspect the route's top-level container/grid classes)"],
    affectedComponent: null,
    explanation: `The page content is ${overflowPx}px wider than the ${context.viewport} viewport (document.documentElement.scrollWidth ${documentMetrics.scrollWidth}px vs clientWidth ${documentMetrics.clientWidth}px), which produces an unwanted horizontal scrollbar or clipped content at this breakpoint.`,
    proposedImprovement: "Find the element causing the overflow (a fixed-width child, an un-wrapped flex/grid row, or a table without a horizontal scroll container) and constrain it to the viewport width, or wrap it in its own scrollable container.",
    validationRequirements: ["Re-capture screenshot evidence at this route/viewport after the fix and confirm scrollWidth <= clientWidth", "Manually verify no content became newly hidden by the fix"],
    prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not remove content to hide the overflow instead of fixing the layout"],
    rollbackDescription: "Revert the CSS/layout change; no data or schema is touched by a horizontal-overflow fix.",
  })];
}

export function findClippedOrTruncatedControls(context) {
  return context.snapshot.elements
    .filter((el) => el.isInteractive && el.visible && el.overflow.scrollWidth > el.overflow.clientWidth + OVERFLOW_TOLERANCE_PX)
    .map((el) => baseDraft(context, {
      ruleId: "clipped-truncated-control", category: FINDING_CATEGORY.CLIPPED_OR_TRUNCATED_CONTROL,
      severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the component rendering "${el.selector}")`], affectedComponent: el.selector,
      explanation: `The interactive control at "${el.selector}" has content wider than its own box (scrollWidth ${Math.round(el.overflow.scrollWidth)}px vs clientWidth ${Math.round(el.overflow.clientWidth)}px), so part of its label or content is being clipped rather than shown.`,
      proposedImprovement: "Give the control enough width to show its full label, allow it to wrap, or shorten the label text -- whichever matches the design intent for this control.",
      validationRequirements: ["Re-capture screenshot evidence and confirm the control's scrollWidth no longer exceeds its clientWidth", "Confirm the control's accessible name is unaffected by any text change"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
      rollbackDescription: "Revert the control's width/label change; no data or schema is touched.",
    }));
}

const OVERLAP_AREA_RATIO_THRESHOLD = 0.3;

function rectArea(rect) { return Math.max(0, rect.width) * Math.max(0, rect.height); }

function intersectionArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

// A crude but deterministic ancestor guard: our selectors are truncated DOM-path strings, so a real
// ancestor/descendant pair shares a literal prefix up to the shorter selector's length. Not a perfect
// DOM-ancestry check, but sufficient to avoid flagging a container and its own child as "overlapping" --
// which is exactly why this rule's confidence is capped at MEDIUM, never HIGH.
function looksLikeAncestorPair(selectorA, selectorB) {
  return selectorA.startsWith(selectorB) || selectorB.startsWith(selectorA);
}

export function findOverlappingContent(context) {
  const candidates = context.snapshot.elements.filter((el) => el.visible && rectArea(el.rect) > 0);
  const drafts = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (looksLikeAncestorPair(a.selector, b.selector)) continue;
      const overlap = intersectionArea(a.rect, b.rect);
      if (overlap <= 0) continue;
      const smallerArea = Math.min(rectArea(a.rect), rectArea(b.rect));
      if (smallerArea === 0 || overlap / smallerArea < OVERLAP_AREA_RATIO_THRESHOLD) continue;
      drafts.push(baseDraft(context, {
        ruleId: "overlapping-content", category: FINDING_CATEGORY.OVERLAPPING_CONTENT,
        severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.MEDIUM,
        probableSourceFiles: [`(inspect the components rendering "${a.selector}" and "${b.selector}")`], affectedComponent: a.selector,
        explanation: `"${a.selector}" and "${b.selector}" overlap by roughly ${Math.round((overlap / smallerArea) * 100)}% of the smaller element's area, which is unusual for two unrelated, non-nested elements and often indicates a positioning defect (e.g. a missing z-index/stacking context, or a fixed/absolute-positioned element not accounting for surrounding content).`,
        proposedImprovement: "Confirm whether this overlap is intentional (a deliberate overlay). If not, adjust the positioning/stacking of one of the two elements so they no longer intersect.",
        validationRequirements: ["Re-capture screenshot evidence and visually confirm the elements no longer overlap unintentionally", "Confirm the fix does not hide an element that should remain visible"],
        prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not remove either element to resolve the overlap without owner confirmation this is safe"],
        rollbackDescription: "Revert the positioning/stacking change; no data or schema is touched.",
      }));
    }
  }
  return drafts;
}

// A page opts into spacing review by grouping siblings under a shared data-fb-ui-spacing-group value
// -- not yet adopted anywhere in the real app (same honesty as FB-UI-1's data-fb-ui-ready convention),
// so this rule produces zero findings until a component adopts it. The grid unit (4px) is a common
// convention, not a claim about this app's specific design system -- flagged at MEDIUM confidence,
// never HIGH, since "inconsistent" is judged against a generic grid, not this app's own documented one.
const SPACING_GRID_PX = 4;
const SPACING_TOLERANCE_PX = 1;

export function findInconsistentSpacing(context) {
  return context.snapshot.spacingSamples
    .filter((sample) => Math.abs(Math.round(sample.gapPx / SPACING_GRID_PX) * SPACING_GRID_PX - sample.gapPx) > SPACING_TOLERANCE_PX)
    .map((sample) => baseDraft(context, {
      ruleId: "inconsistent-spacing", category: FINDING_CATEGORY.INCONSISTENT_SPACING,
      severity: FINDING_SEVERITY.LOW, confidence: FINDING_CONFIDENCE.MEDIUM,
      probableSourceFiles: [`(inspect spacing between "${sample.selectorA}" and "${sample.selectorB}")`], affectedComponent: sample.selectorA,
      explanation: `The gap between "${sample.selectorA}" and "${sample.selectorB}" is ${Math.round(sample.gapPx)}px, which does not fall on this review's ${SPACING_GRID_PX}px spacing grid -- inconsistent gaps between otherwise-similar elements are a common source of a page looking visually uneven.`,
      proposedImprovement: `Adjust the gap to the nearest ${SPACING_GRID_PX}px increment (or to this app's own documented spacing scale, if different from the generic grid this rule checks against).`,
      validationRequirements: ["Re-measure the gap after the fix and confirm it falls on the intended spacing scale", "Visually confirm the change doesn't cause new crowding or excessive whitespace"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
      rollbackDescription: "Revert the spacing/margin change; no data or schema is touched.",
    }));
}
