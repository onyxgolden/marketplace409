// Progress heartbeat helper (FORGE-P-20261119-MUSE-LONG-RUN-PROGRESS-HEARTBEAT).
//
// The helper must emit start / phase / completion lines in order,
// timestamped, with no fake percentages and no secrets — and a
// heartbeat at most once per 60 seconds while waiting on a phase.
// Pure function over an injected stream + clock; no server, no browser.

import { describe, expect, it } from "vitest";
import { createProgress } from "../check-progress.mjs";

function collector() {
  const lines = [];
  return {
    lines,
    stream: { write: (s) => lines.push(s) },
  };
}

const LINE = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[progress\] test-check: /;

describe("createProgress", () => {
  it("emits start, phase, and completion lines in order, all timestamped", () => {
    const { lines, stream } = collector();
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
    });
    progress.start();
    progress.phase("dev server starting");
    progress.phase("running checks");
    progress.done("PASS", { exitCode: 0 });

    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).toMatch(LINE);
    expect(lines[0]).toContain("starting — expected ~10 min");
    expect(lines[0]).toContain("measured: test run");
    expect(lines[1]).toContain("dev server starting");
    expect(lines[2]).toContain("running checks");
    expect(lines[3]).toMatch(/done — PASS in .+ \(exit 0\)/);
  });

  it("names the measured window on the start line and never prints a fake percentage", () => {
    const { lines, stream } = collector();
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "prior runs Nov 18, 2026",
      stream,
    });
    progress.start();
    progress.phase("compiling fixture route");
    progress.done("FAIL", { exitCode: 1 });

    expect(lines.join("")).toContain("expected ~10 min (measured: prior runs Nov 18, 2026)");
    expect(lines.join("")).not.toContain("%");
    expect(lines[2]).toContain("done — FAIL");
    expect(lines[2]).toContain("(exit 1)");
  });

  it("throttles heartbeats to at most one per 60 seconds", () => {
    const { lines, stream } = collector();
    let t = 0;
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
      now: () => t,
    });
    progress.start();
    progress.heartbeat("waiting for dev server");
    t = 30_000;
    progress.heartbeat("waiting for dev server");
    t = 59_999;
    progress.heartbeat("waiting for dev server");
    t = 60_001;
    progress.heartbeat("waiting for dev server");

    // start line + exactly two heartbeats (t=0 and t=60,001)
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("waiting for dev server");
    expect(lines[2]).toContain("waiting for dev server");
  });

  it("reports elapsed time on the completion line from the injected clock", () => {
    const { lines, stream } = collector();
    let t = 0;
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
      now: () => t,
    });
    progress.start();
    t = 125_000;
    progress.done("PASS", { exitCode: 0 });

    expect(lines[1]).toContain("done — PASS in 2m 5s (exit 0)");
  });

  it("requires start() before phase(), heartbeat(), or startWaitHeartbeat()", () => {
    const { stream } = collector();
    const progress = createProgress({ script: "test-check", expected: "~10 min", stream });
    expect(() => progress.phase("x")).toThrow("start() must be called");
    expect(() => progress.heartbeat("x")).toThrow("start() must be called");
    expect(() => progress.startWaitHeartbeat("x")).toThrow("start() must be called");
  });

  it("prints exactly the caller-supplied labels and never inspects process.env", () => {
    // Contract (P2): the helper is a pass-through printer — it prints
    // exactly the labels the caller supplies, with no filtering, and it
    // never reads process.env or child-process output. Label safety is
    // therefore the CALLER's job. This test proves both halves of that
    // boundary non-vacuously: the env value never appears, AND a
    // caller-supplied marker DOES appear — so the test would fail if the
    // helper either leaked the environment or silently dropped labels.
    process.env.CHECK_PROGRESS_SECRET_MARKER = "marker-secret-value-12345";
    try {
      const { lines, stream } = collector();
      const progress = createProgress({
        script: "test-check",
        expected: "~10 min",
        measured: "test run",
        stream,
      });
      progress.start();
      progress.phase("phase-label-marker-67890");
      progress.heartbeat("heartbeat-label-marker-67890");
      progress.done("PASS", { exitCode: 0 });

      const out = lines.join("");
      expect(out).not.toContain("CHECK_PROGRESS_SECRET_MARKER");
      expect(out).not.toContain("marker-secret-value-12345");
      expect(out).toContain("phase-label-marker-67890");
      expect(out).toContain("heartbeat-label-marker-67890");
    } finally {
      delete process.env.CHECK_PROGRESS_SECRET_MARKER;
    }
  });
});

// Fake timers for the wait-phase heartbeat regression (P1): the injected
// clock + timer registry let the test hold a readiness operation pending
// across simulated 60-second boundaries without waiting real minutes.
function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setIntervalFn(cb, ms) {
      const id = nextId++;
      timers.set(id, { cb, ms });
      return id;
    },
    clearIntervalFn(id) {
      timers.delete(id);
    },
    fireAll() {
      for (const { cb } of [...timers.values()]) cb();
    },
  };
}

describe("createProgress wait-phase heartbeat", () => {
  it("emits a timestamped heartbeat while the readiness operation is still pending across a 60s boundary", () => {
    const { lines, stream } = collector();
    const fake = fakeTimers();
    let t = 0;
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
      now: () => t,
      setIntervalFn: fake.setIntervalFn,
      clearIntervalFn: fake.clearIntervalFn,
    });
    progress.start();
    progress.startWaitHeartbeat("waiting for dev server");

    // The timer is scheduled at the 60s heartbeat interval.
    expect(fake.timers.size).toBe(1);
    expect([...fake.timers.values()][0].ms).toBe(60_000);

    // The readiness operation stays pending — nothing resolves, nothing
    // fails. Advance the clock across one 60-second boundary and fire.
    t = 60_001;
    fake.fireAll();

    // start line + exactly one timestamped heartbeat, emitted BEFORE the
    // operation resolves.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(LINE);
    expect(lines[1]).toContain("waiting for dev server");

    // Resolving the operation stops the timer: later ticks emit nothing.
    progress.stopWaitHeartbeat();
    expect(fake.timers.size).toBe(0);
    t = 180_000;
    fake.fireAll();
    expect(lines).toHaveLength(2);
  });

  it("clears the wait-phase timer on stop, on done, and on restart (no leak)", () => {
    const { lines, stream } = collector();
    const fake = fakeTimers();
    let t = 0;
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
      now: () => t,
      setIntervalFn: fake.setIntervalFn,
      clearIntervalFn: fake.clearIntervalFn,
    });
    progress.start();

    // Stopping with no timer running is a no-op, not an error.
    progress.stopWaitHeartbeat();

    progress.startWaitHeartbeat("waiting for dev server");
    expect(fake.timers.size).toBe(1);
    // Restarting replaces the timer instead of adding a second one — a
    // leaked interval would keep the process alive after the script ends.
    progress.startWaitHeartbeat("waiting for dev server");
    expect(fake.timers.size).toBe(1);

    // done() is the teardown backstop: it clears the timer too.
    progress.done("PASS", { exitCode: 0 });
    expect(fake.timers.size).toBe(0);
    t = 120_000;
    fake.fireAll();
    expect(lines.filter((l) => l.includes("waiting for dev server"))).toHaveLength(0);
  });
});
