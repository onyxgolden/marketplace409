import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import FinancialAssetsPanel from "./FinancialAssetsPanel";

describe("FinancialAssetsPanel", () => {
  it("presents the asset registry without treating assets as income", () => {
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("FORGE Assets");
    expect(markup).toContain("Net worth building blocks");
    expect(markup).toContain("Add asset");
    expect(markup).toContain("separately from income and expenses");
  });

  it("provides a lifecycle surface for valuations and retirement", () => {
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("Add asset");
    expect(markup).toContain("Total assets");
    expect(markup).toContain("Business");
    expect(markup).toContain("Personal");
  });
});
