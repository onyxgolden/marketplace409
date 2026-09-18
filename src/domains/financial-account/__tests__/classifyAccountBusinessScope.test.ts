import { describe, expect, test } from "vitest";
import { classifyAccountBusinessScope } from "../classifyAccountBusinessScope";

describe("classifyAccountBusinessScope", () => {
  test("classifies real DuGood account names correctly", () => {
    expect(classifyAccountBusinessScope({ name: "Business Checking - No Div/Fee", officialName: "Dugood Federal Credit Union" })).toBe(
      "business",
    );
    expect(classifyAccountBusinessScope({ name: "Business Savings", officialName: "Dugood Federal Credit Union" })).toBe("business");
    expect(classifyAccountBusinessScope({ name: "Advantage Checking Account", officialName: "Dugood Federal Credit Union" })).toBe(
      "personal",
    );
    expect(classifyAccountBusinessScope({ name: "Home Equity", officialName: "Dugood Federal Credit Union" })).toBe("personal");
    expect(classifyAccountBusinessScope({ name: "Regular Savings Account", officialName: "Dugood Federal Credit Union" })).toBe(
      "personal",
    );
  });

  test("is case-insensitive", () => {
    expect(classifyAccountBusinessScope({ name: "BUSINESS CHECKING" })).toBe("business");
  });

  test("checks both name and official_name", () => {
    expect(classifyAccountBusinessScope({ name: "360 Checking", officialName: "Acme Business Bank" })).toBe("business");
  });

  test("defaults to personal when neither field mentions business", () => {
    expect(classifyAccountBusinessScope({ name: "360 Checking", officialName: "Capital One" })).toBe("personal");
    expect(classifyAccountBusinessScope({})).toBe("personal");
    expect(classifyAccountBusinessScope({ name: null, officialName: undefined })).toBe("personal");
  });
});
