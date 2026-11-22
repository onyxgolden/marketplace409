/**
 * First-frame signal: the one-shot visibility generation/token behind the
 * "first frame rendered" signal (PR #850 fix round 1, verdict P1).
 *
 * The 3D loading overlay must clear only when the renderer has actually
 * rendered a frame after the 3D pane became visible — never on a timer, and
 * never from a stale callback belonging to an earlier visibility. This tiny
 * state machine is the narrowest testable boundary for that contract:
 *
 * - the component calls noteBecameVisible() when its ResizeObserver reports
 *   the pane transitioning hidden -> visible, and noteBecameHidden() when
 *   it reports 0x0 again;
 * - the animation loop calls noteFrameRendered() on the line immediately
 *   after renderer.render(threeScene, camera), so the signal is coupled to
 *   a real render, not to elapsed frame opportunities.
 *
 * Each visibility is a generation. A generation signals at most once, on
 * the first render after it starts; hiding discards the pending generation,
 * so a render that (hypothetically) slipped through after a hide can never
 * clear a later switch's overlay.
 */

export function createFirstFrameSignal() {
  let generation = 0;
  let pendingGeneration = null;

  return {
    /** The pane transitioned hidden -> visible: arm a new one-shot signal. */
    noteBecameVisible() {
      generation += 1;
      pendingGeneration = generation;
    },

    /** The pane transitioned visible -> hidden: drop any unsignalled generation. */
    noteBecameHidden() {
      pendingGeneration = null;
    },

    /**
     * A real renderer.render() just ran. If a visibility is awaiting its
     * first frame, fire onSignal once with that generation and disarm.
     * Returns true when a signal fired.
     */
    noteFrameRendered(onSignal) {
      if (pendingGeneration === null) return false;
      const signalledGeneration = pendingGeneration;
      pendingGeneration = null;
      onSignal?.(signalledGeneration);
      return true;
    },
  };
}
