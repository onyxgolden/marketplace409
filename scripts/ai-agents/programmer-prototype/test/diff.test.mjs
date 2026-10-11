import { describe, it, expect } from "vitest";
import { parseUnifiedDiff, diffStats, applyDiffExact, renderDiff } from "../src/diff.mjs";
import { REASON } from "../src/constants.mjs";

const base = 'line1\nline2 "Pause"\nline3\n';

describe("parseUnifiedDiff", () => {
  it("parses a single-file edit", () => {
    const text = renderDiff("src/a.mjs", "modify", base, base.replace('"Pause"', '"Paused"'));
    const parsed = parseUnifiedDiff(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].path).toBe("src/a.mjs");
    const stats = diffStats(parsed);
    expect(stats.files).toBe(1);
    expect(stats.added + stats.removed).toBeGreaterThan(0);
  });

  it("round-trips through applyDiffExact", () => {
    const next = base.replace('"Pause"', '"Paused"');
    const text = renderDiff("src/a.mjs", "modify", base, next);
    const parsed = parseUnifiedDiff(text);
    expect(parsed.ok).toBe(true);
    const out = applyDiffExact(parsed, new Map([["src/a.mjs", base]]));
    expect(out.ok).toBe(true);
    expect(out.files.get("src/a.mjs")).toBe(next);
  });

  it("refuses to apply when context does not match", () => {
    const next = base.replace('"Pause"', '"Paused"');
    const text = renderDiff("src/a.mjs", "modify", base, next);
    const parsed = parseUnifiedDiff(text);
    expect(parsed.ok).toBe(true);
    const out = applyDiffExact(parsed, new Map([["src/a.mjs", 'line1\nline2 "CHANGED"\nline3\n']]));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe(REASON.PATCH_NOT_APPLICABLE);
  });

  it("rejects an empty diff as malformed", () => {
    const parsed = parseUnifiedDiff("");
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe(REASON.PATCH_MALFORMED);
  });

  it("rejects deletion diffs as out of scope", () => {
    const text = "--- a/src/a.mjs\n+++ /dev/null\n@@ -1 +0,0 @@\n-line1\n";
    const parsed = parseUnifiedDiff(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe(REASON.OPERATION_FORBIDDEN);
  });
});
