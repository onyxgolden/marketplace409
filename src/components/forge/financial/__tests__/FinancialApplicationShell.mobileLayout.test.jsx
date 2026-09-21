// @vitest-environment jsdom
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

// The real children include JSX-in-.js files that vitest's esbuild transform can't parse -- same
// reason the main FinancialApplicationShell test mocks them. Lightweight stand-ins keep the exact
// data attributes the order assertions check.
vi.mock("../FinancialExecutiveIntelligence", () => ({
  default: function MockIntelligence() { return <section data-financial-executive-intelligence />; },
}));
vi.mock("../FinancialPositionSnapshot", () => ({
  default: function MockPosition() { return <section data-financial-position-snapshot />; },
}));
vi.mock("../FinancialForgeOverviewPanel", () => ({
  default: function MockOverview() { return <section data-financial-forge-overview />; },
}));
vi.mock("../FinancialAccountBalancesPanel", () => ({
  default: function MockAccounts() { return <section data-financial-account-balances />; },
}));
vi.mock("../FinancialWorkspaceHeader", () => ({
  default: function MockHeader() { return <section data-financial-workspace-header />; },
}));
vi.mock("../FinancialTransactionsSurface", () => ({
  default: function MockTransactions() { return <section data-transactions-function />; },
}));
vi.mock("../FinancialWelcomeOnboarding", () => ({
  default: function MockWelcome() { return <section data-financial-welcome-onboarding />; },
}));
vi.mock("@/components/forge/property/RentalPortfolioPerformance", () => ({
  default: function MockProperties() { return <section data-properties-function />; },
}));
vi.mock("../SimplifiImportPanel", () => ({
  default: function MockImport() { return <section data-simplifi-import-function />; },
}));
vi.mock("../FinancialAssetsPanel", () => ({
  default: function MockAssets() { return <section data-assets-function />; },
}));
vi.mock("../InvestmentAccountsPanel", () => ({
  default: function MockInvestments() { return <section data-investments-function />; },
}));
vi.mock("../FinancialLoanToolsPanel", () => ({
  default: function MockTools() { return <section data-tools-function />; },
}));
vi.mock("../FinancialWorkspaceSidebar", () => ({
  default: function MockOperations() { return <section data-operations-function />; },
}));

import FinancialApplicationShell from "../FinancialApplicationShell.jsx";
import FinancialKpiSurface from "../FinancialKpiSurface.jsx";

describe("FinancialApplicationShell mobile layout", () => {
  it("passes mobileBottomNav through to ApplicationShell so phones get the fixed bottom nav", () => {
    const markup = renderToStaticMarkup(
      <FinancialApplicationShell activeFunctionId="overview" loadState="ready" accounts={[{ id: "acct-1" }]} />,
    );
    expect(markup).toContain("data-mobile-bottom-nav");
    expect(markup).toContain("lg:hidden");
  });

  it("orders the overview hero (headline + KPIs) before the accounts/activity stack on mobile, keeping desktop order intact", () => {
    const markup = renderToStaticMarkup(
      <FinancialApplicationShell activeFunctionId="overview" loadState="ready" accounts={[{ id: "acct-1" }]} />,
    );
    // Mobile is a flex column: the header wrapper carries order-1, the accounts/activity grid
    // carries order-2, so the hero + KPIs render first on phones.
    expect(markup).toContain('class="order-1"><section data-financial-workspace-header');
    expect(markup).toContain('class="order-2 grid grid-cols-1');
    // Desktop (lg:block) ignores order-*, and DOM order still puts the grid first there -- the
    // header stays after the grid on lg+, exactly as before this change.
    expect(markup).toContain("lg:block");
    expect(markup.indexOf('class="order-2 grid grid-cols-1')).toBeLessThan(markup.indexOf('class="order-1"'));
  });

  it("renders the KPI surface as a 2-column grid on mobile", () => {
    const markup = renderToStaticMarkup(
      <FinancialKpiSurface
        variant="workspace"
        kpis={[{ id: "a", label: "Net worth", value: "$1.00" }, { id: "b", label: "Cash", value: "$2.00" }]}
      />,
    );
    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("xl:grid-cols-4");
  });
});
