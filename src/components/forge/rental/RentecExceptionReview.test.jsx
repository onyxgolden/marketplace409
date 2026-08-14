import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentecExceptionReview from "./RentecExceptionReview.jsx";

describe("RentecExceptionReview", () => {
  it("renders grouped exception totals without transaction detail", () => {
    const review = { apiOnlyByYear: [{ label: "2026", count: 7 }], apiOnlyByProperty: [], apiOnlyByCategory: [], probableByYear: [], probableByCategory: [], conflictVarianceBands: [], legacyOnlyByYear: [], legacyOnlyByProperty: [], legacyOnlyByCategory: [] };
    const html = renderToStaticMarkup(<RentecExceptionReview review={review}/>);
    expect(html).toContain("Review transaction exceptions by group");
    expect(html).toContain("API-only by year");
    expect(html).toContain("2026");
    expect(html).toContain("Tenant names, transaction descriptions, and individual amounts are hidden");
  });
});
