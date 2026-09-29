import { describe, expect, it } from "vitest";

import { buildIndexRecords } from "../buildIndexRecords.mjs";

describe("buildIndexRecords (content tokens)", () => {
  const commitSha = "abc123";

  function filesFor(content, filePath = "src/lib/loanPaymentCategory.js") {
    return [{ path: filePath, blobSha: "blob1", content }];
  }

  it("emits bounded, deterministic content_tokens on file records", () => {
    const { records } = buildIndexRecords({
      commitSha,
      files: filesFor("export function categorize(homeEquity) { return getMortgage(homeEquity); } // mortgage"),
    });
    const fileRecord = records.find((r) => r.source_type === "application_source_file");
    expect(fileRecord).toBeTruthy();
    expect(Array.isArray(fileRecord.content_tokens)).toBe(true);
    expect(fileRecord.content_tokens).toContain("mortgage");
    expect(fileRecord.content_tokens).toContain("home");
    expect(fileRecord.content_tokens.length).toBeLessThanOrEqual(128);
    // deterministic: rebuilding the same content yields the same tokens
    const again = buildIndexRecords({ commitSha, files: filesFor("export function categorize(homeEquity) { return getMortgage(homeEquity); } // mortgage") });
    expect(again.records.find((r) => r.source_type === "application_source_file").content_tokens)
      .toEqual(fileRecord.content_tokens);
  });

  it("emits content_tokens on symbol records from the symbol text", () => {
    const { records } = buildIndexRecords({
      commitSha,
      files: filesFor("export function getMortgageSchedule() { return 1; }"),
    });
    const symbolRecord = records.find((r) => r.source_type === "application_source_symbol");
    expect(symbolRecord).toBeTruthy();
    expect(symbolRecord.content_tokens).toContain("mortgage");
  });
});
