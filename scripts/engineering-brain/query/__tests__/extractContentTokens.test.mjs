import { describe, expect, it } from "vitest";

import {
  extractContentTokens,
  CONTENT_TOKEN_STOPWORDS,
  MAX_CONTENT_TOKENS_PER_FILE,
} from "../../extractContentTokens.mjs";

describe("extractContentTokens", () => {
  it("is deterministic across runs and orders by frequency", () => {
    const content = "const homeEquityLoan = getMortgage(home); // mortgage mortgage";
    const a = extractContentTokens(content);
    const b = extractContentTokens(content);
    expect(a).toEqual(b);
    // "mortgage" appears 3x (identifier part + 2x comment) -- outranks everything
    expect(a[0]).toBe("mortgage");
  });

  it("splits camelCase/PascalCase identifiers and keeps the whole run", () => {
    const tokens = extractContentTokens("loanPaymentCategory HTTPHandler");
    expect(tokens).toContain("loan");
    expect(tokens).toContain("payment");
    expect(tokens).toContain("category");
    expect(tokens).toContain("loanpaymentcategory");
    expect(tokens).toContain("http");
    expect(tokens).toContain("handler");
  });

  it("drops stopwords, short tokens, and pure numbers", () => {
    const tokens = extractContentTokens("the why is a an of 12345 1600 ab x1");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("why");
    expect(tokens).not.toContain("12345");
    expect(tokens).not.toContain("1600");
    expect(tokens).not.toContain("ab");
    // every stopword in the shared set is actually filtered
    for (const stopword of CONTENT_TOKEN_STOPWORDS) {
      expect(extractContentTokens(`prefix ${stopword} suffix`)).not.toContain(stopword);
    }
  });

  it("returns [] for empty/missing content", () => {
    expect(extractContentTokens("")).toEqual([]);
    expect(extractContentTokens(null)).toEqual([]);
    expect(extractContentTokens(undefined)).toEqual([]);
  });

  it("caps output at MAX_CONTENT_TOKENS_PER_FILE, most frequent first", () => {
    const words = [];
    for (let i = 0; i < MAX_CONTENT_TOKENS_PER_FILE + 50; i += 1) {
      words.push(`uniqueword${i}`);
    }
    // "repeated" outranks every unique word by frequency
    const tokens = extractContentTokens(`repeated repeated repeated ${words.join(" ")}`);
    expect(tokens.length).toBe(MAX_CONTENT_TOKENS_PER_FILE);
    expect(tokens[0]).toBe("repeated");
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("is case-insensitive and dedupes", () => {
    const tokens = extractContentTokens("Mortgage MORTGAGE mortgage");
    expect(tokens.filter((t) => t === "mortgage").length).toBe(1);
  });
});
