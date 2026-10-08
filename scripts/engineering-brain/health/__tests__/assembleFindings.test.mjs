import { describe, expect, it } from "vitest";
import { assembleFindings } from "../assembleFindings.mjs";

const caps = [
  { id: "ok-cap", name: "Healthy", monitoring_status: "covered", execution_path: "cron" },
  { id: "gap-cap", name: "Gappy", monitoring_status: "partially-covered", monitoring_note: "n", execution_path: "cron2" },
  { id: "dark-cap", name: "Dark", monitoring_status: "uncovered", execution_path: "cron3" },
];

const bugs = [
  { sha: "aaa111", date: "2026-10-01", subject: "Fix login redirect", pr: 100, class: "auth", files: ["src/auth.js"] },
  { sha: "bbb222", date: "2026-10-05", subject: "Fix null pointer", pr: 101, class: "core", files: ["src/core.js", "src/util.js"] },
];

describe("assembleFindings", () => {
  it("skips covered capabilities (no finding for healthy)", () => {
    const f = assembleFindings({ capabilities: caps, bugFixes: [] });
    expect(f.some((x) => x.id === "coverage:ok-cap")).toBe(false);
  });

  it("creates findings for coverage gaps with next steps, not root causes", () => {
    const f = assembleFindings({ capabilities: caps, bugFixes: [] });
    const gap = f.find((x) => x.id === "coverage:gap-cap");
    expect(gap).toBeDefined();
    expect(gap.nextStep).toMatch(/verif|investigat/i);
    expect(gap.what.toLowerCase()).not.toMatch(/root cause/);
    expect(gap.whyItMatters.toLowerCase()).not.toMatch(/root cause/);
  });

  it("carries structured monitoringStatus on coverage findings", () => {
    const f = assembleFindings({ capabilities: caps, bugFixes: [] });
    const gap = f.find((x) => x.id === "coverage:gap-cap");
    const dark = f.find((x) => x.id === "coverage:dark-cap");
    expect(gap.monitoringStatus).toBe("partially-covered");
    expect(dark.monitoringStatus).toBe("uncovered");
  });

  it("deduplicates repeated signals by stable id", () => {
    const dupCaps = [...caps, { ...caps[1] }]; // same id twice
    const f = assembleFindings({ capabilities: dupCaps, bugFixes: [] });
    const ids = f.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deduplicates repeated bug fixes by sha", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: [...bugs, { ...bugs[0] }] });
    const ids = f.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps independent issues separate", () => {
    const f = assembleFindings({ capabilities: caps, bugFixes: bugs });
    // 2 coverage gaps + 2 bugs = 4 distinct findings
    expect(f.length).toBe(4);
  });

  it("orders bug findings newest-first", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: bugs });
    expect(f[0].id).toBe("fix:bbb222");
    expect(f[1].id).toBe("fix:aaa111");
  });

  it("confidence wording never claims verified root cause", () => {
    const f = assembleFindings({ capabilities: caps, bugFixes: bugs });
    for (const x of f) {
      expect(["high", "medium", "low"]).toContain(x.confidence);
      const text = `${x.what} ${x.whyItMatters} ${x.nextStep}`.toLowerCase();
      expect(text).not.toMatch(/root cause (is|was)/);
      expect(text).not.toMatch(/definitively/);
    }
  });

  it("emits evidence-unavailable finding when bug rows fail to load", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: [], bugFixesLoadFailed: true });
    const ev = f.find((x) => x.id === "evidence:bug-catalog-rows-unavailable");
    expect(ev).toBeDefined();
    expect(ev.kind).toBe("evidence-unavailable");
    expect(ev.what).toMatch(/could not be loaded/i);
    expect(ev.whyItMatters).toMatch(/does not mean no defects/i);
    expect(ev.nextStep).toMatch(/do not treat.*zero/i);
  });

  it("never reports zero findings as healthy when rows failed (synthetic finding present)", () => {
    // Dashboard shows "no findings / healthy" only when findings.length === 0.
    // With rows failed, the synthetic finding guarantees non-empty.
    const f = assembleFindings({ capabilities: caps.slice(0, 1), bugFixes: [], bugFixesLoadFailed: true });
    expect(f.length).toBeGreaterThan(0);
  });

  it("emits no synthetic finding when rows loaded OK (even if empty)", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: [], bugFixesLoadFailed: false });
    expect(f.find((x) => x.id === "evidence:bug-catalog-rows-unavailable")).toBeUndefined();
    expect(f.length).toBe(0);
  });

  it("defaults bugFixesLoadFailed to false for backward compatibility", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: [] });
    expect(f.find((x) => x.id === "evidence:bug-catalog-rows-unavailable")).toBeUndefined();
  });

  it("synthetic finding has stable dedup id (no duplicates on repeat)", () => {
    const f = assembleFindings({ capabilities: [], bugFixes: [], bugFixesLoadFailed: true });
    const ids = f.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
