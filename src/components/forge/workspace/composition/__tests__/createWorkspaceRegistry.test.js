import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock(
  "@/components/forge/ForgeExecutiveBriefing",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/financial/FinancialKpiSurface",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/ForgePortfolioSummary",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/ForgeSystemHealth",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/ForgeSystemStatus",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/TransactionReviewContainer",
  () => ({
    default: () => null,
  }),
);

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: () => null,
  }),
);

import {
  createWorkspaceRegistry,
} from "../createWorkspaceRegistry.js";

describe("createWorkspaceRegistry", () => {
  it("registers the production workspace modules", () => {
    const registry =
      createWorkspaceRegistry();

    expect(
      registry.list().map(
        ({ moduleIdentity }) =>
          moduleIdentity,
      ),
    ).toEqual([
      "financial-position",
      "transaction-review",
      "property-portfolio",
      "forge-operating-system",
    ]);
  });

  it("creates an isolated registry instance", () => {
    const firstRegistry =
      createWorkspaceRegistry();

    const secondRegistry =
      createWorkspaceRegistry();

    expect(
      firstRegistry,
    ).not.toBe(
      secondRegistry,
    );

    expect(
      firstRegistry.list(),
    ).toEqual(
      secondRegistry.list(),
    );
  });

  it("supports production module lookup", () => {
    const registry =
      createWorkspaceRegistry();

    expect(
      registry.get(
        "transaction-review",
      )?.displayName,
    ).toBe(
      "Transaction Review",
    );

    expect(
      registry.has(
        "property-portfolio",
      ),
    ).toBe(true);

    expect(
      registry.get(
        "missing-module",
      ),
    ).toBeNull();
  });
});
