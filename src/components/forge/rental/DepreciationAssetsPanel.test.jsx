import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DepreciationAssetsPanel from "./DepreciationAssetsPanel";

describe("depreciation assets panel", () => {
  it("renders the asset register shell with the report-only books note", () => {
    const markup = renderToStaticMarkup(<DepreciationAssetsPanel propertyId="308-paula" />);
    expect(markup).toContain("Assets / Depreciation");
    expect(markup).toContain("Add asset");
    expect(markup).toContain("Report-only");
    expect(markup).toContain("never posts to the property ledger or the bank register");
    expect(markup).toContain("not tax advice");
  });

  it("renders the schedule report controls and print action", () => {
    const markup = renderToStaticMarkup(<DepreciationAssetsPanel propertyId="308-paula" />);
    // The report table itself loads client-side; the shell exposes the year
    // picker and the print action for the CPA hand-off.
    expect(markup).toContain("Depreciation schedule");
    expect(markup).toContain("Print schedule");
    expect(markup).toContain("Year");
    expect(markup).toContain("Loading assets…");
  });
});
