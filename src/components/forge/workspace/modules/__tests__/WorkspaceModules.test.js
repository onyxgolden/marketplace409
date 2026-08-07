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
  "@/components/forge/financial/FinancialExecutiveIntelligence",
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

import { WorkspaceModule } from "../../composition/WorkspaceModule.js";

import {
  FinancialWorkspaceModule,
  ForgeOperatingSystemWorkspaceModule,
  PropertyPortfolioWorkspaceModule,
  TransactionReviewWorkspaceModule,
} from "../index.js";

const modules = [
  {
    workspaceModule:
      FinancialWorkspaceModule,
    moduleIdentity:
      "financial-position",
    displayName:
      "Financial Position",
    category:
      "financial",
    priority:
      10,
  },
  {
    workspaceModule:
      TransactionReviewWorkspaceModule,
    moduleIdentity:
      "transaction-review",
    displayName:
      "Transaction Review",
    category:
      "review",
    priority:
      20,
  },
  {
    workspaceModule:
      PropertyPortfolioWorkspaceModule,
    moduleIdentity:
      "property-portfolio",
    displayName:
      "Property Portfolio",
    category:
      "property",
    priority:
      30,
  },
  {
    workspaceModule:
      ForgeOperatingSystemWorkspaceModule,
    moduleIdentity:
      "forge-operating-system",
    displayName:
      "FORGE OS",
    category:
      "operating-system",
    priority:
      40,
  },
];

describe("production workspace modules", () => {
  it.each(modules)(
    "defines $moduleIdentity as an immutable WorkspaceModule",
    ({
      workspaceModule,
      moduleIdentity,
      displayName,
      category,
      priority,
    }) => {
      expect(
        workspaceModule,
      ).toBeInstanceOf(
        WorkspaceModule,
      );

      expect(
        workspaceModule.moduleIdentity,
      ).toBe(
        moduleIdentity,
      );

      expect(
        workspaceModule.displayName,
      ).toBe(
        displayName,
      );

      expect(
        workspaceModule.category,
      ).toBe(
        category,
      );

      expect(
        workspaceModule.priority,
      ).toBe(
        priority,
      );

      expect(
        typeof workspaceModule.renderTile,
      ).toBe(
        "function",
      );

      expect(
        Object.isFrozen(
          workspaceModule,
        ),
      ).toBe(true);
    },
  );

  it("assigns unique module identities", () => {
    const moduleIdentities =
      modules.map(
        ({ workspaceModule }) =>
          workspaceModule.moduleIdentity,
      );

    expect(
      new Set(moduleIdentities).size,
    ).toBe(
      moduleIdentities.length,
    );
  });

  it("assigns unique deterministic priorities", () => {
    const priorities =
      modules.map(
        ({ workspaceModule }) =>
          workspaceModule.priority,
      );

    expect(priorities).toEqual([
      10,
      20,
      30,
      40,
    ]);

    expect(
      new Set(priorities).size,
    ).toBe(
      priorities.length,
    );
  });
});
