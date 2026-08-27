import { describe, expect, it } from "vitest";
import { scanForPii, containsLikelyPii } from "../piiScanner.mjs";
import { buildIndexRecords } from "../buildIndexRecords.mjs";

describe("PII exclusion (fail-closed)", () => {
  it("detects an SSN-shaped value", () => {
    expect(containsLikelyPii("ssn: 217-63-9048")).toBe(true);
  });

  it("does not flag this codebase's own known-synthetic test SSNs", () => {
    expect(containsLikelyPii("ssn: 123-45-6789")).toBe(false);
  });

  it("does not flag the mere presence of a PII field *name* with no value -- source code references 'ssn' constantly as a column/field name", () => {
    expect(containsLikelyPii("const ssnColumn = 'ssn'; function validateSsn(ssn) { return ssn.length === 9; }")).toBe(false);
  });

  it("detects a Luhn-valid payment-card-shaped number", () => {
    // A real Luhn-valid 16-digit number distinct from any known test-card constant.
    expect(containsLikelyPii("card: 4111111111111111")).toBe(true);
  });

  it("does not false-positive on this repo's own 14-digit migration-timestamp identifiers", () => {
    // No real payment network issues 14-digit card numbers; this is exactly the false-positive
    // source found while building the indexer against the actual repo (governance snapshot ids,
    // migration filenames referenced in docs/tests) and fixed by excluding length-14 runs.
    expect(containsLikelyPii("see supabase/migrations/20260829000100_add_workspace_authorization_helpers.sql")).toBe(false);
  });

  it("buildIndexRecords fails closed: a file containing likely PII is excluded, not indexed", () => {
    const files = [{ path: "src/lib/sample.js", blobSha: "a", content: "// real customer ssn: 217-63-9048" }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files });
    expect(records).toEqual([]);
    expect(excluded[0].reason).toBe("likely_pii:ssn_like_value");
  });
});
