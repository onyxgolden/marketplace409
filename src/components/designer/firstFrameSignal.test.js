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

import { describe, expect, it } from "vitest";
import { createFirstFrameSignal } from "./firstFrameSignal";

describe("createFirstFrameSignal", () => {
  it("never signals before the pane has become visible", () => {
    const signal = createFirstFrameSignal();
    const onSignal = () => {
      throw new Error("must not fire");
    };
    expect(signal.noteFrameRendered(onSignal)).toBe(false);
    expect(signal.noteFrameRendered(onSignal)).toBe(false);
  });

  it("signals exactly once on the first render after becoming visible", () => {
    const signal = createFirstFrameSignal();
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
    const seen = [];
    signal.noteBecameVisible(); // gen 1
    signal.noteFrameRendered((gen) => seen.push(gen));
    signal.noteBecameHidden();
    signal.noteBecameVisible(); // gen 2
    signal.noteFrameRendered((gen) => seen.push(gen));
    expect(seen).toEqual([1, 2]);
  });
});
