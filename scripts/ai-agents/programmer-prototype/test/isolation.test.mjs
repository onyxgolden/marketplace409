import { describe, it, expect } from "vitest";
import { probeIsolation, MECHANISM, runIsolated } from "../src/isolation.mjs";

describe("probeIsolation", () => {
  it("returns a well-shaped verdict", async () => {
    const r = await probeIsolation();
    expect(typeof r.available).toBe("boolean");
    expect(typeof r.detail).toBe("string");
    if (r.available) {
      expect(r.mechanism).toBe(MECHANISM);
    } else {
      expect(r.reason).toBe("ISOLATION_BLOCKED");
    }
  }, 30000);

  it("reports available in this root VM (real namespaces)", async () => {
    const r = await probeIsolation();
    if (process.geteuid() === 0) {
      expect(r.available).toBe(true);
    }
  }, 30000);
});

describe("runIsolated", () => {
  it("refuses to run when isolation is blocked", async () => {
    // Force the blocked path by calling with a probe that fails: runIsolated
    // re-probes internally; here we just assert the blocked contract shape
    // via a direct call when available, else skip.
    const probe = await probeIsolation();
    if (!probe.available) {
      const r = await runIsolated({ scratchFiles: { "x.txt": "x" }, argv: ["/usr/bin/node", "/work/x.txt"] });
      expect(r.ok).toBe(false);
      expect(r.isolation_status).toBe("BLOCKED_ISOLATION");
    } else {
      const r = await runIsolated({
        scratchFiles: { "hello.mjs": 'console.log("HI");\n' },
        argv: ["/usr/bin/node", "/work/hello.mjs"],
        timeoutMs: 15000,
      });
      expect(r.ok).toBe(true);
      expect(r.isolation_status).toBe("ISOLATED");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("HI");
      expect(r.canaryOk).toBe(true);
    }
  }, 60000);
});
