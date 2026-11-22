/**
 * Hidden-pane work policy — the phone scroll-freeze fix (FCCU Designer,
 * Jason's live report 2026-11-21: scrolling to the 3D picker froze four
 * times, 10-15s each).
 *
 * The 3D viewport is always mounted, so while the user works in 2D the 3D
 * pane is hidden — but two pieces of main-thread work kept running against
 * it with no visibility guard:
 *
 * (a) the animate loop rendered the full FCCU scene 60x/s into a pane
 *     nobody could see, starving the main thread the page scroll needs;
 * (b) every design change ran a synchronous buildThreeScene rebuild
 *     (120ms debounce) on the main thread — a multi-second block per
 *     rebuild on a big FCCU design.
 *
 * This module holds the two decisions, in the smallest testable form:
 * shouldRenderFrame gates the animate loop; createDeferredRebuild defers
 * rebuilds until the pane is visible again, coalescing any number of
 * hidden requests into a single build on show. The component wires them
 * into the animation loop, the rebuild effect, and the ResizeObserver
 * (which owns the visibility truth: a hidden pane reports 0x0).
 */

/**
 * The animate loop renders a frame only while the pane is visible AND the
 * document is shown. A backgrounded tab's rAF is already throttled by the
 * browser; the document.hidden leg makes the skip explicit rather than
 * relying on that throttle.
 */
export function shouldRenderFrame(paneVisible, documentHidden) {
  return paneVisible && !documentHidden;
}

/**
 * Deferred rebuilds: a rebuild requested while the pane is hidden must not
 * run — it would block scrolling for seconds. It waits, and becoming
 * visible makes exactly one rebuild due, however many requests piled up
 * while hidden.
 */
export function createDeferredRebuild() {
  let deferred = false;

  return {
    /**
     * A rebuild is due. Returns "run" when it may run now, "defer" when
     * the pane is hidden and the build must wait for visibility.
     */
    requestRebuild(isVisible) {
      if (isVisible) {
        deferred = false;
        return "run";
      }
      deferred = true;
      return "defer";
    },

    /**
     * The pane became visible. Returns true when a deferred rebuild is
     * now due (consumed — a second call without a new request is false).
     */
    noteBecameVisible() {
      if (!deferred) return false;
      deferred = false;
      return true;
    },

    /** Whether a rebuild is currently waiting for visibility. */
    isDeferred() {
      return deferred;
    },
  };
}
