// Builds the browser-context script that gathers a UiDiagnosticsSnapshot -- the structured,
// measurable DOM/CSSOM facts every FB-UI-2 finding rule runs against. This is what makes "unreadable
// contrast", "overlapping content", "undersized touch targets" etc. deterministic rather than a vision
// model's guess at pixels: every one of those categories is computed here from getBoundingClientRect(),
// getComputedStyle(), and the accessible-name/role a real assistive-technology user would actually get,
// not from looking at the rendered image.
//
// Deliberately scoped to interactive elements, text-bearing leaf elements, and a small set of opt-in
// `data-fb-ui-*` markers (chart/empty-state/spacing-group), not the entire DOM -- the same "propose an
// opt-in convention, be honest that it isn't adopted yet" approach FB-UI-1 already used for
// data-fb-ui-ready/data-fb-ui-sensitive. Runs strictly after redaction (see
// captureDiagnosticsEvidence.mjs) so any real text this snapshot captures has already been masked.
//
// Same pattern as redaction.mjs's buildRedactionInitScript: a plain string, built once from named
// constants so it can be unit-tested for shape/content without a browser, and reconstructed verbatim
// inside the page via page.evaluate(script).

export const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';
export const STATUS_SELECTOR = '[role="status"], [role="alert"]';
export const CHART_MARKER_ATTRIBUTE = "data-fb-ui-chart";
export const EMPTY_STATE_MARKER_ATTRIBUTE = "data-fb-ui-empty-state";
export const SPACING_GROUP_ATTRIBUTE = "data-fb-ui-spacing-group";

// WCAG 2.5.5 (AAA)/2.5.8 (AA minimum): 24x24 CSS px is the AA floor for a pointer target with no
// established exception; this module uses the AA floor deliberately, since it is the more commonly
// enforced threshold in production UI review and a lower bar produces fewer false positives than the
// 44x44 AAA target would.
export const MINIMUM_TOUCH_TARGET_PX = 24;

export function buildDiagnosticsCaptureScript() {
  return `(() => {
    const interactiveSelector = ${JSON.stringify(INTERACTIVE_SELECTOR)};
    const statusSelector = ${JSON.stringify(STATUS_SELECTOR)};
    const chartAttr = ${JSON.stringify(CHART_MARKER_ATTRIBUTE)};
    const emptyStateAttr = ${JSON.stringify(EMPTY_STATE_MARKER_ATTRIBUTE)};
    const spacingAttr = ${JSON.stringify(SPACING_GROUP_ATTRIBUTE)};

    function cssPath(el) {
      if (!(el instanceof Element)) return "";
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) { part += "#" + node.id; parts.unshift(part); break; }
        const siblingIndex = [...(node.parentElement ? node.parentElement.children : [])].indexOf(node) + 1;
        part += ":nth-child(" + siblingIndex + ")";
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }

    function computedAccessibleName(el) {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/).map((id) => { const t = document.getElementById(id); return t ? t.textContent : ""; }).join(" ").trim();
        if (text) return text;
      }
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
        if (el.id) { const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (label && label.textContent.trim()) return label.textContent.trim(); }
        const closestLabel = el.closest("label");
        if (closestLabel && closestLabel.textContent.trim()) return closestLabel.textContent.trim();
        const placeholder = el.getAttribute("placeholder");
        if (placeholder && placeholder.trim()) return placeholder.trim();
      }
      const title = el.getAttribute("title");
      if (title && title.trim()) return title.trim();
      const alt = el.getAttribute("alt");
      if (alt && alt.trim()) return alt.trim();
      const text = (el.textContent || "").trim();
      if (text) return text;
      return "";
    }

    // A computed backgroundColor is very often "rgba(0, 0, 0, 0)" (transparent) -- most elements paint
    // no background of their own and simply show whatever their nearest opaque ancestor painted.
    // Contrast math needs the *effective* background, so this walks up the ancestor chain to the first
    // non-transparent one, falling back to the browser's own white document default if none is found --
    // the same resolution a sighted user's eye performs implicitly.
    function effectiveBackgroundColor(el) {
      let node = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    }

    function elementDiagnostics(el) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector: cssPath(el),
        tagName: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        overflow: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
        computedStyle: {
          color: style.color, backgroundColor: style.backgroundColor, effectiveBackgroundColor: effectiveBackgroundColor(el),
          fontSizePx: parseFloat(style.fontSize) || 0, fontWeight: style.fontWeight,
          outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow,
          textOverflow: style.textOverflow, whiteSpace: style.whiteSpace,
        },
        accessibleName: computedAccessibleName(el),
        text: (el.textContent || "").trim().slice(0, 200),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      };
    }

    const interactiveElements = [...document.querySelectorAll(interactiveSelector)].map((el) => {
      const diag = elementDiagnostics(el);
      let focusVisibleChanged = null;
      try {
        const before = { outlineStyle: diag.computedStyle.outlineStyle, outlineWidth: diag.computedStyle.outlineWidth, boxShadow: diag.computedStyle.boxShadow };
        el.focus({ preventScroll: true });
        const afterStyle = getComputedStyle(el);
        const after = { outlineStyle: afterStyle.outlineStyle, outlineWidth: afterStyle.outlineWidth, boxShadow: afterStyle.boxShadow };
        focusVisibleChanged = JSON.stringify(before) !== JSON.stringify(after);
        el.blur();
      } catch { focusVisibleChanged = null; }
      return { ...diag, isInteractive: true, focusVisibleChanged };
    });

    // Leaf text-bearing elements: has its own non-whitespace text and no element children with their
    // own text -- avoids double-reporting a contrast finding once for a <p> and again for identical
    // text on its parent <div>.
    const textLeafElements = [...document.querySelectorAll("body *")]
      .filter((el) => {
        if (el.matches(interactiveSelector)) return false;
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
        if (!ownText) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, 500) // hard cap -- a pathological page must not produce an unbounded snapshot
      .map((el) => ({ ...elementDiagnostics(el), isInteractive: false, focusVisibleChanged: null }));

    const statusMarkers = [...document.querySelectorAll(statusSelector)].map((el) => ({
      selector: cssPath(el), role: el.getAttribute("role"), text: (el.textContent || "").trim().slice(0, 200),
    }));

    const chartMarkers = [...document.querySelectorAll("[" + chartAttr + "]")].map((el) => ({
      selector: cssPath(el),
      hasRangeLabel: Boolean((el.getAttribute("data-fb-ui-chart-range") || "").trim()),
      declaredIncomplete: el.getAttribute("data-fb-ui-chart-incomplete") === "true",
      communicatesIncomplete: Boolean((el.getAttribute("data-fb-ui-chart-incomplete-label") || "").trim()),
    }));

    const emptyStateMarkers = [...document.querySelectorAll("[" + emptyStateAttr + "]")].map((el) => {
      const rect = el.getBoundingClientRect();
      return { selector: cssPath(el), isEmpty: el.getAttribute(emptyStateAttr) === "true", rect: { width: rect.width, height: rect.height } };
    });

    const spacingGroups = {};
    document.querySelectorAll("[" + spacingAttr + "]").forEach((el) => {
      const group = el.getAttribute(spacingAttr);
      (spacingGroups[group] ||= []).push(el);
    });
    const spacingSamples = Object.entries(spacingGroups).flatMap(([group, els]) => {
      const sorted = els.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      const samples = [];
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = sorted[i].getBoundingClientRect();
        const b = sorted[i + 1].getBoundingClientRect();
        const gapPx = Math.max(0, b.top - a.bottom, b.left - a.right);
        samples.push({ group, selectorA: cssPath(sorted[i]), selectorB: cssPath(sorted[i + 1]), gapPx });
      }
      return samples;
    });

    return {
      documentMetrics: {
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight,
        // Prefers the page's own resolved color-scheme (what it actually rendered) over the media
        // query alone, since a page can force a scheme independent of the OS/browser preference.
        colorScheme: getComputedStyle(document.documentElement).colorScheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
      },
      elements: [...interactiveElements, ...textLeafElements],
      statusMarkers, chartMarkers, emptyStateMarkers, spacingSamples,
    };
  })();`;
}
