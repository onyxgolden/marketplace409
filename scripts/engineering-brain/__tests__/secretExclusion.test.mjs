import { describe, expect, it } from "vitest";
import { scanForSecrets, containsLikelySecret } from "../secretScanner.mjs";
import { buildIndexRecords } from "../buildIndexRecords.mjs";

describe("secret exclusion (fail-closed)", () => {
  it("detects a Stripe live secret key", () => {
    expect(containsLikelySecret("const key = 'sk_live_0000000000000000';")).toBe(true);
  });

  it("detects a PEM private key block", () => {
    expect(containsLikelySecret("-----BEGIN RSA PRIVATE KEY-----\nMIIB...")).toBe(true);
  });

  it("does not flag a reference to an environment variable -- that is the correct way to hold a secret", () => {
    expect(containsLikelySecret("const key = process.env.STRIPE_SECRET_KEY;")).toBe(false);
  });

  it("does not flag ordinary source code with no secret-shaped content", () => {
    expect(containsLikelySecret("export function add(a, b) { return a + b; }")).toBe(false);
  });

  it("names the matched pattern without ever returning the matched secret text itself", () => {
    const secretValue = "sk_live_0000000000000001";
    const matches = scanForSecrets(`const key = '${secretValue}';`);
    expect(matches).toEqual(["stripe_live_secret_key"]);
    expect(matches.join(",")).not.toContain(secretValue);
  });

  it("buildIndexRecords fails closed: a file containing a likely secret is excluded, not indexed, and the exclusion reason is sanitized", () => {
    const secretValue = "sk_live_0000000000000001";
    const files = [{ path: "src/lib/config.js", blobSha: "a", content: `export const key = "${secretValue}";` }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files });

    expect(records).toEqual([]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].reason).toBe("likely_secret:stripe_live_secret_key");
    expect(JSON.stringify(excluded)).not.toContain(secretValue);
  });
});
