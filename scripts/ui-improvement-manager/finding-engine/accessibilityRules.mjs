// Accessibility rules: unreadable contrast, missing dark-mode foreground colors, undersized touch
// targets, missing accessible names, keyboard-focus visibility. Same pure-function shape as
// layoutRules.mjs -- see that file's header for the context/draft contract.

import {
  WCAG_AA_LARGE_TEXT_RATIO, WCAG_AA_NORMAL_TEXT_RATIO, WCAG_AA_UI_COMPONENT_RATIO,
  contrastRatio, isLargeText, parseComputedRgb,
} from "./contrastMath.mjs";
import { MINIMUM_TOUCH_TARGET_PX } from "./diagnosticsSnapshotScript.mjs";
import { FINDING_CATEGORY, FINDING_CLASS, FINDING_CONFIDENCE, FINDING_SEVERITY, PROPOSAL_STATUS } from "./findingContracts.mjs";

function baseDraft(context, overrides) {
  return {
    findingClass: FINDING_CLASS.DETERMINISTIC, application: context.application, routeId: context.routeId,
    routePath: context.routePath, viewport: context.viewport, screenshotHash: context.screenshotHash,
    status: PROPOSAL_STATUS.NEW, ...overrides,
  };
}

// Contrast failures are reported once, but under a different category depending on whether the page
// resolved to a dark color scheme at capture time -- "missing dark-mode foreground colors" is
// specifically about a color pairing that only breaks once dark mode is active (e.g. dark text that
// was never given a dark-mode override), which is a distinct, common defect class from a generically
// low-contrast light-mode pairing.
export function findContrastIssues(context) {
  const isDark = context.snapshot.documentMetrics.colorScheme === "dark";
  const drafts = [];
  for (const el of context.snapshot.elements) {
    if (!el.visible || !el.text) continue;
    const fg = parseComputedRgb(el.computedStyle.color);
    const bg = parseComputedRgb(el.computedStyle.effectiveBackgroundColor);
    if (!fg || !bg) continue; // unparseable/transparent -- fail closed by skipping, never guessing
    const ratio = contrastRatio(fg, bg);
    const threshold = el.isInteractive
      ? WCAG_AA_UI_COMPONENT_RATIO
      : (isLargeText({ fontSizePx: el.computedStyle.fontSizePx, fontWeight: el.computedStyle.fontWeight }) ? WCAG_AA_LARGE_TEXT_RATIO : WCAG_AA_NORMAL_TEXT_RATIO);
    if (ratio >= threshold) continue;
    const category = isDark ? FINDING_CATEGORY.MISSING_DARK_MODE_FOREGROUND : FINDING_CATEGORY.UNREADABLE_CONTRAST;
    drafts.push(baseDraft(context, {
      ruleId: isDark ? "missing-dark-mode-foreground" : "unreadable-contrast", category,
      severity: ratio < threshold * 0.7 ? FINDING_SEVERITY.HIGH : FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the component rendering "${el.selector}"${isDark ? " -- likely missing a dark-mode color override" : ""})`],
      affectedComponent: el.selector,
      explanation: `"${el.selector}" has a WCAG contrast ratio of ${ratio.toFixed(2)}:1 between its text color and its effective background, below the ${threshold}:1 minimum for ${el.isInteractive ? "an interactive control" : "this text size"}${isDark ? " while the page is in dark mode" : ""}. This makes the content difficult or impossible for many users to read.`,
      proposedImprovement: isDark
        ? "Add or correct a dark-mode-specific foreground color for this element so it meets the WCAG AA contrast minimum against its dark-mode background."
        : "Darken the text color, lighten the background, or both, until the contrast ratio meets the WCAG AA minimum for this content.",
      validationRequirements: ["Recompute the contrast ratio after the fix and confirm it meets the WCAG AA threshold used here", "Re-capture screenshot evidence and visually confirm the text is legible"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
      rollbackDescription: "Revert the color change; no data or schema is touched.",
    }));
  }
  return drafts;
}

export function findUndersizedTouchTargets(context) {
  return context.snapshot.elements
    .filter((el) => el.isInteractive && el.visible && (el.rect.width < MINIMUM_TOUCH_TARGET_PX || el.rect.height < MINIMUM_TOUCH_TARGET_PX))
    .map((el) => baseDraft(context, {
      ruleId: "undersized-touch-target", category: FINDING_CATEGORY.UNDERSIZED_TOUCH_TARGET,
      severity: FINDING_SEVERITY.MEDIUM, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the component rendering "${el.selector}")`], affectedComponent: el.selector,
      explanation: `The interactive control "${el.selector}" measures ${Math.round(el.rect.width)}x${Math.round(el.rect.height)}px, below the WCAG 2.5.8 (AA) minimum pointer-target size of ${MINIMUM_TOUCH_TARGET_PX}x${MINIMUM_TOUCH_TARGET_PX}px. Small targets are hard to activate accurately, especially on touchscreens.`,
      proposedImprovement: `Increase this control's tappable area (padding, min-width/min-height, or a larger hit-slop) to at least ${MINIMUM_TOUCH_TARGET_PX}x${MINIMUM_TOUCH_TARGET_PX}px.`,
      validationRequirements: ["Re-measure the control's bounding box after the fix and confirm both dimensions are >= the minimum", "Confirm the larger control doesn't newly overlap a neighboring control"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
      rollbackDescription: "Revert the sizing/padding change; no data or schema is touched.",
    }));
}

export function findMissingAccessibleNames(context) {
  return context.snapshot.elements
    .filter((el) => el.isInteractive && el.visible && !el.accessibleName)
    .map((el) => baseDraft(context, {
      ruleId: "missing-accessible-name", category: FINDING_CATEGORY.MISSING_ACCESSIBLE_NAME,
      severity: FINDING_SEVERITY.HIGH, confidence: FINDING_CONFIDENCE.HIGH,
      probableSourceFiles: [`(inspect the component rendering "${el.selector}")`], affectedComponent: el.selector,
      explanation: `The interactive <${el.tagName}> at "${el.selector}" has no computed accessible name (no visible text, aria-label, aria-labelledby, associated <label>, title, or alt). A screen-reader user has no way to know what this control does.`,
      proposedImprovement: "Add visible text, an aria-label, or an associated <label> that describes what this control does.",
      validationRequirements: ["Re-run the accessible-name computation after the fix and confirm it is non-empty", "Confirm the added name accurately describes the control's actual action"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows"],
      rollbackDescription: "Revert the label/aria-attribute addition; no data or schema is touched.",
    }));
}

export function findKeyboardFocusVisibilityIssues(context) {
  return context.snapshot.elements
    .filter((el) => el.isInteractive && el.visible && el.focusVisibleChanged === false)
    .map((el) => baseDraft(context, {
      ruleId: "keyboard-focus-visibility", category: FINDING_CATEGORY.KEYBOARD_FOCUS_VISIBILITY,
      severity: FINDING_SEVERITY.HIGH, confidence: FINDING_CONFIDENCE.MEDIUM,
      probableSourceFiles: [`(inspect the component rendering "${el.selector}" and any global focus-style reset)`], affectedComponent: el.selector,
      explanation: `Focusing "${el.selector}" produced no detectable change to its outline, box-shadow, or border -- a keyboard user tabbing through the page gets no visible indication that this control is focused.`,
      proposedImprovement: "Add a visible focus style (an outline or box-shadow that appears only on :focus-visible) so keyboard users can see which control is active.",
      validationRequirements: ["Tab to the control and re-measure whether its computed style changes on focus", "Confirm the focus style has sufficient contrast against the surrounding page"],
      prohibitedScope: ["Must not change financial calculations, authorization, RLS, payment behavior, or contractual workflows", "Must not globally disable :focus-visible resets in a way that could affect unrelated controls without validating each one"],
      rollbackDescription: "Revert the focus-style addition; no data or schema is touched.",
    }));
}
