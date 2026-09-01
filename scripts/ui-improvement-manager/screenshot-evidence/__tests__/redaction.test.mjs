import { describe, expect, it, vi } from "vitest";
import {
  REDACTION_APPLIED_ATTRIBUTE, RedactionVerificationError, SENSITIVE_SELECTORS, TEXT_REDACTION_RULES,
  applyAndVerifyRedaction, buildRedactionInitScript, redactText,
} from "../redaction.mjs";

describe("redactText", () => {
  it("masks an email address", () => {
    const result = redactText("Contact borrower at jane.doe@example.com for details.");
    expect(result.text).not.toContain("jane.doe@example.com");
    expect(result.text).toContain("[REDACTED:email]");
    expect(result.rulesApplied).toContain("email");
  });

  it("masks an SSN-shaped value", () => {
    const result = redactText("SSN on file: 123-45-6789");
    expect(result.text).not.toContain("123-45-6789");
    expect(result.rulesApplied).toContain("ssn_like");
  });

  it("masks a long digit run that looks like an account/routing number", () => {
    const result = redactText("Account ending in 123456789012");
    expect(result.text).not.toContain("123456789012");
    expect(result.rulesApplied).toContain("financial_identifier_like");
  });

  it("masks a card-shaped grouped number", () => {
    const result = redactText("Card 4242 4242 4242 4242 on file");
    expect(result.text).not.toContain("4242 4242 4242 4242");
    expect(result.rulesApplied).toContain("card_like");
  });

  it("leaves ordinary text untouched and reports no rules applied", () => {
    const result = redactText("Balance Sheet Snapshot");
    expect(result.text).toBe("Balance Sheet Snapshot");
    expect(result.rulesApplied).toEqual([]);
  });

  it("returns non-string input unchanged rather than throwing", () => {
    expect(redactText(null)).toBeNull();
    expect(redactText(42)).toBe(42);
  });

  it("applies every rule at least once across the fixture set (no dead pattern)", () => {
    const sample = "jane@example.com 123-45-6789 12-3456789 4242 4242 4242 4242 123456789012";
    const applied = new Set(redactText(sample).rulesApplied);
    for (const rule of TEXT_REDACTION_RULES) expect(applied.has(rule.name)).toBe(true);
  });
});

describe("buildRedactionInitScript", () => {
  it("embeds every text redaction rule and sensitive selector, and sets the verification attribute", () => {
    const script = buildRedactionInitScript();
    for (const rule of TEXT_REDACTION_RULES) expect(script).toContain(rule.name);
    // Selectors are embedded via JSON.stringify, so their quotes come through escaped (\") rather
    // than as the literal selector substring -- assert on the category name and the shared attribute
    // name instead, which is what actually proves each selector made it into the generated script.
    for (const selector of SENSITIVE_SELECTORS) {
      const category = selector.match(/"([^"]+)"/)[1];
      expect(script).toContain(category);
    }
    expect(script).toContain("data-fb-ui-sensitive");
    expect(script).toContain(REDACTION_APPLIED_ATTRIBUTE);
  });

  it("is valid, self-invoking JavaScript source (parses without throwing)", () => {
    // Doesn't execute in jsdom's DOM (no document.body access outside jsdom test env), just proves
    // the generated string is syntactically well-formed JS -- `new Function` throws SyntaxError on
    // malformed source without running it.
    expect(() => new Function(buildRedactionInitScript())).not.toThrow();
  });
});

function mockPage({ appliedAttribute = "true" } = {}) {
  return {
    evaluate: vi.fn()
      .mockResolvedValueOnce(undefined) // the injection call
      .mockResolvedValueOnce(appliedAttribute), // the verification read-back call
  };
}

describe("applyAndVerifyRedaction", () => {
  it("injects the script then verifies the applied attribute, in that order", async () => {
    const page = mockPage();
    await applyAndVerifyRedaction(page);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(page.evaluate.mock.calls[0][0]).toContain(REDACTION_APPLIED_ATTRIBUTE);
  });

  it("fails closed with RedactionVerificationError when the applied attribute was never set", async () => {
    const page = mockPage({ appliedAttribute: null });
    await expect(applyAndVerifyRedaction(page)).rejects.toThrow(RedactionVerificationError);
  });
});
