import {
  ManagerRegistry,
} from "../kernel/index.js";

import {
  RepositoryIntelligenceManager,
} from "./repository/index.js";

export function registerVersionOneManagers() {
  const registry = new ManagerRegistry();

  registry.register(
    new RepositoryIntelligenceManager(),
  );

  return registry;
}
