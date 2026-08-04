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

import {
  registerVersionOneWorkspaces,
  WorkspaceCoordinator,
} from "../workspaces/index.js";

export function createForgeRuntime() {
  const managerRegistry =
    registerVersionOneManagers();

  const workspaceRegistry =
    registerVersionOneWorkspaces();

  const workspaceCoordinator =
    new WorkspaceCoordinator({
      workspaceRegistry,
      managerRegistry,
    });

  const workspaceActivationReport =
    workspaceCoordinator.activateAll();

  return new ForgeRuntime({
    managerRegistry,

    contextStore:
      createCanonicalContextStore(),

    contextContributionApplier:
      new ContextContributionApplier(),

    evidenceCoordinator:
      new EvidenceCoordinator(),

    workspaceRegistry,

    workspaceCoordinator,

    workspaceActivationReport,
  });
}
