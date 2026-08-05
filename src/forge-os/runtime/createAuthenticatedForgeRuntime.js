import {
  registerVersionOneManagers,
} from "../managers/registerVersionOneManagers.js";

import {
  registerAuthenticatedBusinessManagers,
} from "../managers/index.js";

import {
  registerVersionOneWorkspaces,
  registerFinancialWorkspace,
  WorkspaceCoordinator,
} from "../workspaces/index.js";

import {
  createCanonicalContextStore,
  ContextContributionApplier,
} from "../context/index.js";

import {
  ForgeRuntime,
} from "./ForgeRuntime.js";

import {
  EvidenceCoordinator,
} from "./EvidenceCoordinator.js";

async function loadAuthenticatedApplicationFactory() {
  const {
    createAuthenticatedForgeApplication,
  } = await import(
    "../../lib/supabase/createAuthenticatedForgeApplication.js"
  );

  return createAuthenticatedForgeApplication;
}

export async function createAuthenticatedForgeRuntime({
  authenticatedApplicationFactory,
} = {}) {
  if (
    authenticatedApplicationFactory !== undefined &&
    typeof authenticatedApplicationFactory !==
      "function"
  ) {
    throw new Error(
      "Authenticated FORGE runtime requires an authenticated application factory.",
    );
  }

  const applicationFactory =
    authenticatedApplicationFactory ??
    await loadAuthenticatedApplicationFactory();

  const authenticatedApplication =
    await applicationFactory();

  if (authenticatedApplication?.response) {
    return authenticatedApplication;
  }

  if (
    !authenticatedApplication ||
    typeof authenticatedApplication
      .getForgeApplicationSuite !==
      "function"
  ) {
    throw new Error(
      "Authenticated FORGE runtime requires an authenticated FORGE application.",
    );
  }

  const forgeApplicationSuite =
    await authenticatedApplication
      .getForgeApplicationSuite();

  const managerRegistry =
    registerVersionOneManagers();

  const businessManagerRegistration =
    registerAuthenticatedBusinessManagers({
      managerRegistry,
      forgeApplicationSuite,
    });

  const workspaceRegistry =
    registerVersionOneWorkspaces();

  const financialWorkspaceRegistration =
    registerFinancialWorkspace({
      workspaceRegistry,
    });

  const workspaceCoordinator =
    new WorkspaceCoordinator({
      workspaceRegistry,
      managerRegistry,
    });

  const workspaceActivationReport =
    workspaceCoordinator.activateAll();

  const runtime =
    new ForgeRuntime({
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

  return Object.freeze({
    runtime,
    authenticatedApplication,
    forgeApplicationSuite,
    managerRegistry,
    businessManagerRegistration,
    workspaceRegistry,
    financialWorkspaceRegistration,
    workspaceCoordinator,
    workspaceActivationReport,
  });
}
