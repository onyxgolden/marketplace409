import {
  ForgeRuntime,
} from "./ForgeRuntime.js";

import {
  registerVersionOneManagers,
} from "../managers/registerVersionOneManagers.js";

import {
  createCanonicalContextStore,
  ContextContributionApplier,
} from "../context/index.js";

import {
  EvidenceCoordinator,
} from "./EvidenceCoordinator.js";

export function createForgeRuntime() {
  return new ForgeRuntime({
    managerRegistry:
      registerVersionOneManagers(),

    contextStore:
      createCanonicalContextStore(),

    contextContributionApplier:
      new ContextContributionApplier(),

    evidenceCoordinator:
      new EvidenceCoordinator(),
  });
}
