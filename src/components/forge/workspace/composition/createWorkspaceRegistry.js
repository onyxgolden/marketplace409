import { WorkspaceRegistry } from "./WorkspaceRegistry.js";

import {
  FinancialWorkspaceModule,
  ForgeOperatingSystemWorkspaceModule,
  PropertyPortfolioWorkspaceModule,
  TransactionReviewWorkspaceModule,
} from "../modules/index.js";

export function createWorkspaceRegistry() {
  const registry = new WorkspaceRegistry();

  registry.register(
    FinancialWorkspaceModule,
  );

  registry.register(
    TransactionReviewWorkspaceModule,
  );

  registry.register(
    PropertyPortfolioWorkspaceModule,
  );

  registry.register(
    ForgeOperatingSystemWorkspaceModule,
  );

  return registry;
}
