import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";

vi.stubGlobal("fetch", vi.fn());
import InvestmentAccountsPanel from "./InvestmentAccountsPanel";

const investmentPayload = {
  accounts: [{
    id: "inv-1", name: "Traditional IRA", institutionName: "", accountType: "ira",
    taxTreatment: "tax_deferred", ownershipScope: "personal",
    latestValuation: { amountCents: 410213, effectiveDate: "2026-08-01" }, notes: "",
  }],
};

describe("InvestmentAccountsPanel", () => {
  // The panel serves the module-global SWR cache: seed it the way a warm visit
  // would, or clear it to assert the cold-load contract.
  beforeEach(() => { clearSWRCache(); });

  it("presents the investment registry without treating account values as income", async () => {
    await fetchWithDedupe("financial:investment-accounts", () => Promise.resolve(investmentPayload));
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("FORGE Investments");
    expect(markup).toContain("Brokerage, retirement");
    expect(markup).toContain("Add account");
    expect(markup).toContain("separately from bank cash and physical assets");
    expect(markup).not.toContain("Loading investment accounts");
  });

  it("provides a lifecycle surface for valuations and retirement", async () => {
    await fetchWithDedupe("financial:investment-accounts", () => Promise.resolve(investmentPayload));
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("Add account");
    expect(markup).toContain("Total investable assets");
    expect(markup).toContain("Business");
    expect(markup).toContain("Personal");
    expect(markup).toContain("Traditional IRA");
  });

  it("renders an honest empty registry instead of fabricated zero totals", async () => {
    await fetchWithDedupe("financial:investment-accounts", () => Promise.resolve({ accounts: [] }));
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("Your investment registry is ready");
  });

  it("shows the loading skeleton only when nothing is cached", () => {
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("Loading investment accounts…");
    expect(markup).not.toContain("FORGE Investments");
  });
});
