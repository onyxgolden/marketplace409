import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";

vi.stubGlobal("fetch", vi.fn());
import FinancialAssetsPanel from "./FinancialAssetsPanel";

const assetsPayload = {
  assets: [{
    id: "asset-1", name: "2015 Toyota Tacoma", assetClass: "vehicle", ownershipScope: "personal",
    latestValuation: { amountCents: 1800000, effectiveDate: "2026-08-01", source: "manual" },
    purchaseCostCents: null, purchaseDate: null, linkedPropertyId: null, notes: null,
  }],
  properties: [],
};

describe("FinancialAssetsPanel", () => {
  // The panel serves the module-global SWR cache: seed it the way a warm visit
  // would, or clear it to assert the cold-load contract.
  beforeEach(() => { clearSWRCache(); });

  it("presents the asset registry without treating assets as income", async () => {
    await fetchWithDedupe("financial:assets", () => Promise.resolve(assetsPayload));
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("FORGE Assets");
    expect(markup).toContain("Net worth building blocks");
    expect(markup).toContain("Add asset");
    expect(markup).toContain("separately from income and expenses");
    expect(markup).not.toContain("Loading assets");
  });

  it("provides a lifecycle surface for valuations and retirement", async () => {
    await fetchWithDedupe("financial:assets", () => Promise.resolve(assetsPayload));
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("Add asset");
    expect(markup).toContain("Total assets");
    expect(markup).toContain("Business");
    expect(markup).toContain("Personal");
    expect(markup).toContain("2015 Toyota Tacoma");
  });

  it("renders an honest empty registry instead of fabricated zero totals", async () => {
    await fetchWithDedupe("financial:assets", () => Promise.resolve({ assets: [], properties: [] }));
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("Your asset registry is ready");
  });

  it("shows the loading skeleton only when nothing is cached", () => {
    const markup = renderToStaticMarkup(<FinancialAssetsPanel />);
    expect(markup).toContain("Loading assets…");
    expect(markup).not.toContain("FORGE Assets");
  });
});
