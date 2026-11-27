// firstFrameSignal — the one-shot visibility generation/token behind the
// "first frame rendered" signal (PR #850 fix round 1).
//
// Contract (verdict P1, read firsthand): the loading overlay must clear only
// when the renderer has actually rendered a frame after the 3D pane became
// visible — never on a timer, and never from a stale callback belonging to
// an earlier visibility. This module is the narrowest testable boundary for
// that contract: the component wires noteBecameVisible/noteBecameHidden to
// its ResizeObserver and noteFrameRendered to the line right after
// renderer.render() in the animation loop. These tests pin the generation
// bookkeeping itself, independent of WebGL (unavailable in jsdom).
//
// Fix round 2 (re-review finding A): the signal is ALSO gated on scene
// readiness — a render of an older/empty scene must not clear the overlay.
// The rebuild effect calls noteBuildRequested() whenever it schedules a
// build for a new design/modelEpoch and noteBuildCommitted(generation)
// only when that build actually lands in the scene; a failed build calls
// noteBuildFailed() instead and never commits. A render signals only when
// a visibility is pending AND the latest requested build has committed.

import { describe, expect, it } from "vitest";
import { createFirstFrameSignal } from "./firstFrameSignal";

describe("createFirstFrameSignal", () => {
  // Fix round 2: the signal is gated on scene readiness, so the visibility
  // tests below all establish a committed build first — they keep
  // exercising the visibility bookkeeping they were written for, with the
  // scene already current.
  function withCommittedBuild(signal) {
    const gen = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen);
  }

  it("never signals before the pane has become visible", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    const onSignal = () => {
      throw new Error("must not fire");
    };
    expect(signal.noteFrameRendered(onSignal)).toBe(false);
    expect(signal.noteFrameRendered(onSignal)).toBe(false);
  });

  it("signals exactly once on the first render after becoming visible", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    let calls = 0;
    signal.noteBecameVisible();
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
    // One-shot: the next frame must not re-signal the same visibility.
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(1);
  });

  it("a hide before any render discards the pending generation, so a stale callback cannot clear a later switch", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    let calls = 0;
    signal.noteBecameVisible(); // generation 1 armed…
    signal.noteBecameHidden(); // …but the pane hid again before any frame rendered
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(0);

    // The next visibility is a NEW generation and signals exactly once.
    signal.noteBecameVisible(); // generation 2
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(1);
  });

  it("rapid visible -> hidden -> visible without an intervening render signals only the latest generation, once", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    const generations = [];
    signal.noteBecameVisible(); // gen 1
    signal.noteBecameHidden();
    signal.noteBecameVisible(); // gen 2
    signal.noteBecameHidden();
    signal.noteBecameVisible(); // gen 3
    expect(signal.noteFrameRendered((gen) => generations.push(gen))).toBe(true);
    expect(generations).toHaveLength(1);
    expect(signal.noteFrameRendered((gen) => generations.push(gen))).toBe(false);
    expect(generations).toHaveLength(1);
  });

  it("each new visibility re-arms after a completed signal", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    let calls = 0;
    signal.noteBecameVisible();
    signal.noteFrameRendered(() => calls++);
    signal.noteBecameHidden();
    signal.noteBecameVisible();
    signal.noteFrameRendered(() => calls++);
    expect(calls).toBe(2);
  });

  it("reports the generation that signalled, so the caller can match it to the visibility it belongs to", () => {
    const signal = createFirstFrameSignal();
    withCommittedBuild(signal);
    const seen = [];
    signal.noteBecameVisible(); // gen 1
    signal.noteFrameRendered((gen) => seen.push(gen));
    signal.noteBecameHidden();
    signal.noteBecameVisible(); // gen 2
    signal.noteFrameRendered((gen) => seen.push(gen));
    expect(seen).toEqual([1, 2]);
  });
});

describe("scene-ready gating (fix round 2, verdict finding A)", () => {
  it("first mount: renders before the first build commits do not signal; the first render after the commit does", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    signal.noteBecameVisible(); // pane shows before any build has landed
    expect(signal.noteFrameRendered(() => calls++)).toBe(false); // empty scene
    expect(calls).toBe(0);
    const gen = signal.noteBuildRequested(); // rebuild effect schedules the first build
    expect(signal.noteFrameRendered(() => calls++)).toBe(false); // build pending
    expect(calls).toBe(0);
    signal.noteBuildCommitted(gen);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true); // committed scene renders
    expect(calls).toBe(1);
  });

  it("slow rebuild: renders while a rebuild is pending stay silent until the commit lands", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen1);
    signal.noteBecameVisible();
    expect(signal.noteFrameRendered(() => calls++)).toBe(true); // current scene
    expect(calls).toBe(1);

    // A design change requests a rebuild; renders of the old scene must
    // not clear the next switch's overlay.
    signal.noteBecameHidden();
    signal.noteBecameVisible();
    const gen2 = signal.noteBuildRequested();
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(1);
    signal.noteBuildCommitted(gen2);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(2);
  });

  it("stale rendered scene: a newer requested build supersedes the committed one until it commits", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen1);
    signal.noteBecameVisible();
    const gen2 = signal.noteBuildRequested(); // design changed while visible
    // The loop keeps rendering the old (gen-1) scene; none of those renders
    // may clear the overlay — the current design is not ready yet.
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(0);
    signal.noteBuildCommitted(gen2);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
  });

  it("hide -> show -> hide -> show: a pending generation is discarded on hide, and the new visibility still waits for the pending build", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen1);
    signal.noteBecameVisible(); // show 1
    signal.noteBecameHidden(); // hide before any render
    signal.noteBecameVisible(); // show 2
    const gen2 = signal.noteBuildRequested(); // design changed while hidden
    expect(signal.noteFrameRendered(() => calls++)).toBe(false); // build pending
    signal.noteBecameHidden(); // hide again before the build lands
    signal.noteBecameVisible(); // show 3
    expect(signal.noteFrameRendered(() => calls++)).toBe(false); // still pending
    signal.noteBuildCommitted(gen2);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
  });

  it("build failure: a failed build never signals; a retry of the same generation that commits does", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen1);
    signal.noteBecameVisible();
    const gen2 = signal.noteBuildRequested();
    signal.noteBuildFailed(gen2, new Error("boom"));
    // Renders of the stale scene must never claim the failed build succeeded.
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    expect(calls).toBe(0);
    // A retry of the same generation that commits DOES signal — the
    // committed scene is the current design again.
    signal.noteBuildCommitted(gen2);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
  });

  it("a newer build supersedes a failed one; only the newer commit opens the gate", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen1);
    signal.noteBecameVisible();
    const gen2 = signal.noteBuildRequested();
    signal.noteBuildFailed(gen2, new Error("boom"));
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    const gen3 = signal.noteBuildRequested(); // user edits again
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    signal.noteBuildCommitted(gen3);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);
  });

  it("a build that commits while hidden satisfies the gate for the next visibility (deferred-build composition, PR #851)", () => {
    const signal = createFirstFrameSignal();
    let calls = 0;
    const gen1 = signal.noteBuildRequested();
    signal.noteBecameVisible(); // pane shows before the first build lands
    expect(signal.noteFrameRendered(() => calls++)).toBe(false);
    signal.noteBuildCommitted(gen1);
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(1);

    // And the deferred-while-hidden shape: build requested + committed
    // entirely while hidden, then the next visibility signals on its first
    // render — the committed scene is already the current design.
    signal.noteBecameHidden();
    const gen2 = signal.noteBuildRequested();
    signal.noteBuildCommitted(gen2);
    signal.noteBecameVisible();
    expect(signal.noteFrameRendered(() => calls++)).toBe(true);
    expect(calls).toBe(2);
  });
});
