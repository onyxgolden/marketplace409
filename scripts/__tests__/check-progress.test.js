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

  it("requires start() before phase() or heartbeat()", () => {
    const { stream } = collector();
    const progress = createProgress({ script: "test-check", expected: "~10 min", stream });
    expect(() => progress.phase("x")).toThrow("start() must be called");
    expect(() => progress.heartbeat("x")).toThrow("start() must be called");
  });

  it("never prints environment values, paths, or tokens", () => {
    process.env.CHECK_PROGRESS_SECRET_MARKER = "marker-secret-value-12345";
    const { lines, stream } = collector();
    const progress = createProgress({
      script: "test-check",
      expected: "~10 min",
      measured: "test run",
      stream,
    });
    progress.start();
    progress.phase("running checks");
    progress.done("PASS", { exitCode: 0 });

    const out = lines.join("");
    expect(out).not.toContain("marker-secret-value-12345");
    expect(out).not.toContain("CHECK_PROGRESS_SECRET_MARKER");
    expect(out).not.toContain("/home/");
    expect(out).not.toContain("node_modules");
    delete process.env.CHECK_PROGRESS_SECRET_MARKER;
  });
});
