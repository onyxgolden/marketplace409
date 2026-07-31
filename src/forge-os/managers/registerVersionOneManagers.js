import {
  ManagerRegistry,
} from "../kernel/index.js";

import {
  RepositoryIntelligenceManager,
} from "./repository/index.js";

import {
  MemoryManager,
} from "./memory/index.js";

export function registerVersionOneManagers() {
  const registry = new ManagerRegistry();

  registry.register(
    new RepositoryIntelligenceManager(),
  );

  registry.register(
    new MemoryManager(),
  );

  return registry;
}
