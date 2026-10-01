import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dstScheduleGuard.sh"
);

const epoch = (y, mo, d, h, mi = 0) => Math.floor(Date.UTC(y, mo, d, h, mi) / 1000);

function shouldRunPass(epochSeconds) {
  return execFileSync(
    "bash",
    [
      "-c",
      `. "${SCRIPT}" && should_run_pass "${epochSeconds}"`,
    ],
    { encoding: "utf8" }
  ).trim();
}

describe("dstScheduleGuard.sh should_run_pass", () => {
  it("normal CDT day: 06:00 UTC runs, 07:00 UTC no-ops (2026-07-01)", () => {
    expect(shouldRunPass(epoch(2026, 6, 1, 6))).toBe("true");
    expect(shouldRunPass(epoch(2026, 6, 1, 7))).toBe("false");
  });

  it("normal CST day: 06:00 UTC no-ops, 07:00 UTC runs (2026-01-15)", () => {
    expect(shouldRunPass(epoch(2026, 0, 15, 6))).toBe("false");
    expect(shouldRunPass(epoch(2026, 0, 15, 7))).toBe("true");
  });

  it("fall-back day: exactly one execution, the second 1:00 AM (2026-11-01)", () => {
    // 06:00 UTC = 01:00 CDT (first of two 1:00 AMs) -> no-op
    expect(shouldRunPass(epoch(2026, 10, 1, 6))).toBe("false");
    // 07:00 UTC = 01:00 CST (second 1:00 AM) -> runs
    expect(shouldRunPass(epoch(2026, 10, 1, 7))).toBe("true");
  });

  it("spring-forward day: 1:00 AM still occurs exactly once (2026-03-08)", () => {
    // 06:00 UTC = 00:00 CST (the jump is at 08:00 UTC) -> no-op
    expect(shouldRunPass(epoch(2026, 2, 8, 6))).toBe("false");
    // 07:00 UTC = 01:00 CST, occurs exactly once (the 02:00 hour is skipped) -> runs
    expect(shouldRunPass(epoch(2026, 2, 8, 7))).toBe("true");
  });

  it("defaults to now when no epoch is given", () => {
    const out = execFileSync(
      "bash",
      ["-c", `. "${SCRIPT}" && should_run_pass`],
      { encoding: "utf8" }
    ).trim();
    expect(["true", "false"]).toContain(out);
  });
});
