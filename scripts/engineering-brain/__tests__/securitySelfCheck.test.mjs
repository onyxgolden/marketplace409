import { describe, expect, it } from "vitest";
import { runSecuritySelfCheck } from "../securitySelfCheck.mjs";

describe("runSecuritySelfCheck", () => {
  it("passes every security property on the current indexer code", () => {
    const result = runSecuritySelfCheck();
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("checks at least the six required fail-closed properties", () => {
    const result = runSecuritySelfCheck();
    expect(result.checks.length).toBeGreaterThanOrEqual(6);
  });

  it("is deterministic", () => {
    expect(runSecuritySelfCheck()).toEqual(runSecuritySelfCheck());
  });
});
