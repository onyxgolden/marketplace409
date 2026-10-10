import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FindingTheMoneyPanel from "./FindingTheMoneyPanel";

// Pins the ported "Finding the Money" page: disclaimers at both ends, every
// part of the researched content (DTI wall, property-based loans, private &
// hard money with the scam warnings, construction/renovation, the honest-math
// decision table, unverified items, sources), and exactly the package's two
// calculators — no more.

describe("FindingTheMoneyPanel", () => {
  const markup = renderToStaticMarkup(<FindingTheMoneyPanel />);

  it("keeps the educational-only disclaimer at the top and the bottom of the page", () => {
    expect(markup).toContain("Educational only — not financial, legal, tax, or lending advice.");
    expect(markup).toContain("this page is customer education, not advice");
    expect(markup.indexOf("Educational only — not financial")).toBeLessThan(
      markup.indexOf("DTI limits: the borrower-based wall"),
    );
  });

  it("ports every part of the researched page", () => {
    for (const heading of [
      "Finding the Money: DTI, Property-Based Loans, and Private &amp; Hard Money",
      "DTI limits: the borrower-based wall",
      "How rental income is actually counted: the 75% rule",
      "Reserves and the 10-property ceiling",
      "How investors get around the ceiling",
      "Loans that underwrite the property, not you",
      "DSCR loans",
      "Bank / portfolio loans &amp; local credit unions",
      "Start local before you go national",
      "Commercial loans for 5+ units",
      "Private money &amp; hard money",
      "Typical terms, 2025/2026 — market ranges, not guarantees",
      "Scams and fraud patterns to warn about",
      "Where to actually find them",
      "Construction &amp; renovation loans: how a damaged fixer-upper gets financed at all",
      "The partially-completed play",
      "The contractor catch: draws go through a named contractor",
      "The Texas contractor advantage — with the fine print",
      "Which money for which situation — and the honest math",
      "Sample deal: hard money vs. conventional, in dollars",
      "Holding the same money: why hard money is not a rental loan",
      "Decision table",
      "When expensive money can beat no deal",
      "What could not be verified",
      "Sources",
    ]) {
      expect(markup).toContain(heading);
    }
    // The worked hard-money example and the never-a-hold-product math survive.
    expect(markup).toContain("≈ $28,800");
    expect(markup).toContain("−$300/mo");
    expect(markup).toContain("Holding hard money is lighting money on fire");
  });

  it("includes exactly the package's two calculators, with their page prompts", () => {
    expect(markup).toContain("Try it: what does one more door do to your DTI?");
    expect(markup).toContain("Try it: your property’s DSCR");
    expect(markup).toContain("Enter your numbers and calculate.");
    expect(markup).toContain("Enter rent and PITIA and calculate.");
    expect(markup.match(/Calculate/g)).toHaveLength(2);
  });
});
