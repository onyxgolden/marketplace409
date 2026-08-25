import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import InvestmentAccountsPanel from "./InvestmentAccountsPanel";

describe("InvestmentAccountsPanel", () => {
  it("presents the investment registry without treating account values as income", () => {
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("FORGE Investments");
    expect(markup).toContain("Brokerage, retirement");
    expect(markup).toContain("Add account");
    expect(markup).toContain("separately from bank cash and physical assets");
  });

  it("provides a lifecycle surface for valuations and retirement", () => {
    const markup = renderToStaticMarkup(<InvestmentAccountsPanel />);
    expect(markup).toContain("Add account");
    expect(markup).toContain("Total investable assets");
    expect(markup).toContain("Business");
    expect(markup).toContain("Personal");
  });
});
