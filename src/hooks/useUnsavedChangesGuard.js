"use client";

import { useEffect } from "react";

// D9 (Planner audit, 2026-11-10): no form warned before unsaved work was
// lost to navigation. Cancel itself is exempt — "Cancel discards" is the
// correct, documented contract (BUILD_CONTRACT.md rule 5) and needs no
// prompt. This guards the other two ways work was silently lost: a real
// page leave (reload, typed URL, tab close) via `beforeunload`, and an
// in-app Link click elsewhere in the app while a form has unsaved edits —
// Next.js client-side navigation never fires `beforeunload`, so without
// this, clicking a sidebar/nav link mid-edit discarded the edit with no
// warning at all.
//
// Scoped to a single container ref rather than the whole document, so a
// click inside the editing form's own Cancel/Save controls is never
// second-guessed by this guard — only a click on a link that leaves the
// container is.
export function useUnsavedChangesGuard(hasUnsavedChanges, containerRef) {
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;

    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    function onClickCapture(event) {
      const link = event.target.closest?.("a[href]");
      // A link marked data-discard-link (e.g. a form's own Cancel button)
      // is the documented "Cancel discards" contract, not a leave-and-lose
      // surprise — never prompted.
      if (!link || link.hasAttribute("data-discard-link")) return;
      const confirmed = window.confirm(
        "You have unsaved changes. Leave this page and discard them?",
      );
      if (!confirmed) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    const container = containerRef?.current || document;
    container.addEventListener("click", onClickCapture, true);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      container.removeEventListener("click", onClickCapture, true);
    };
  }, [hasUnsavedChanges, containerRef]);
}
