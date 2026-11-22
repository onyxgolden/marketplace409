/**
 * First-frame signal: the one-shot visibility generation/token behind the
 * "first frame rendered" signal (PR #850 fix round 1, verdict P1), extended
 * in fix round 2 with scene-ready gating (re-review finding A).
 *
 * The 3D loading overlay must clear only when the renderer has rendered a
 * frame of the CURRENT design after the 3D pane became visible. A render
 * of an older/empty scene — the first frame after a show can precede the
 * debounced scene rebuild, or a build deferred while hidden (#851) — must
 * never clear the overlay. So the signal is bound to TWO generations:
 *
 * - a visibility generation: hidden -> visible arms one; a hide discards
 *   a pending one, so a stale callback can never clear a later switch;
 * - a scene-build generation: the viewport's rebuild effect calls
 *   noteBuildRequested() whenever it schedules a build for a new
 *   design/modelEpoch, and noteBuildCommitted(generation) only when that
 *   build actually lands in the scene (swapContentGroup). A failed build
 *   calls noteBuildFailed(generation, error) instead and never commits.
 *
 * A render signals only when a visibility is pending AND the latest
 * requested build has committed (committed === requested). A build that
 * commits while hidden satisfies the gate for the next visibility, which
 * is what lets a deferred build (#851) compose with this signal: the
 * deferred build is requested on the design change, commits after the
 * show, and only then does a render signal. (The #851 rebase must keep
 * this rule: noteBuildRequested on every rebuild-effect run — even when
 * the build is deferred — and noteBuildCommitted only on actual commit.)
 *
 * Each visibility signals at most once; stale build or render callbacks
 * can never clear a later switch's overlay.
 */

export function createFirstFrameSignal() {
  let visibilityGeneration = 0;
  let pendingVisibility = null;
  let requestedBuild = 0;
  let committedBuild = null; // null until the first build commits
  let failedBuild = null; // { generation, error } of the latest failed build, or null

  return {
    /** The pane transitioned hidden -> visible: arm a new one-shot signal. */
    noteBecameVisible() {
      visibilityGeneration += 1;
      pendingVisibility = visibilityGeneration;
    },

    /** The pane transitioned visible -> hidden: drop any unsignalled generation. */
    noteBecameHidden() {
      pendingVisibility = null;
    },

    /**
     * A build for a new design/modelEpoch was scheduled. Returns the
     * generation the build will commit as. Call this on every rebuild-
     * effect run — even when the build is deferred (#851) — so the gate
     * knows a newer scene is pending.
     */
    noteBuildRequested() {
      requestedBuild += 1;
      return requestedBuild;
    },

    /**
     * A build committed its scene (swapContentGroup). A stale commit for
     * an older generation never moves the committed generation backward.
     * Committing the latest requested build clears a recorded failure.
     */
    noteBuildCommitted(generation) {
      if (committedBuild === null || generation > committedBuild) {
        committedBuild = generation;
      }
      if (failedBuild !== null && failedBuild.generation <= committedBuild) {
        failedBuild = null;
      }
    },

    /**
     * A build failed: it never commits, so the gate stays closed for it.
     * The overlay must not claim success for a failed build.
     */
    noteBuildFailed(generation, error) {
      if (failedBuild === null || generation >= failedBuild.generation) {
        failedBuild = { generation, error };
      }
    },

    /**
     * A real renderer.render() just ran. If a visibility is awaiting its
     * first frame AND the latest requested build has committed — i.e. the
     * rendered frame shows the current design — fire onSignal once with
     * that visibility generation and disarm. Renders of an older/empty
     * scene stay silent. Returns true when a signal fired.
     */
    noteFrameRendered(onSignal) {
      if (pendingVisibility === null) return false;
      if (committedBuild === null || committedBuild !== requestedBuild) return false;
      const signalledVisibility = pendingVisibility;
      pendingVisibility = null;
      onSignal?.(signalledVisibility);
      return true;
    },
  };
}
