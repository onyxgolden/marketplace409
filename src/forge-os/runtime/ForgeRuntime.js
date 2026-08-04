import {
  ContractDispatcher,
  GovernanceEvaluator,
  LifecycleCoordinator,
} from "../kernel/index.js";

import {
  EvidenceCoordinator,
} from "./EvidenceCoordinator.js";

import {
  buildSessionSnapshot,
} from "../session/index.js";

export class ForgeRuntime {
  constructor({
    managerRegistry,
    contextStore,
    contextContributionApplier,
    governanceEvaluator = new GovernanceEvaluator(),
    evidenceCoordinator = new EvidenceCoordinator(),
    sessionSnapshotBuilder =
      buildSessionSnapshot,
    lifecycleCoordinatorFactory =
      () => new LifecycleCoordinator(),
    workspaceRegistry = null,
    workspaceCoordinator = null,
    workspaceActivationReport =
      Object.freeze([]),
  }) {
    if (!managerRegistry) {
      throw new Error(
        "ForgeRuntime requires a managerRegistry.",
      );
    }

    if (!contextStore) {
      throw new Error(
        "ForgeRuntime requires a contextStore.",
      );
    }

    if (!contextContributionApplier) {
      throw new Error(
        "ForgeRuntime requires a contextContributionApplier.",
      );
    }

    if (!governanceEvaluator) {
      throw new Error(
        "ForgeRuntime requires a governanceEvaluator.",
      );
    }

    if (!evidenceCoordinator) {
      throw new Error(
        "ForgeRuntime requires an evidenceCoordinator.",
      );
    }

    if (!sessionSnapshotBuilder) {
      throw new Error(
        "ForgeRuntime requires a sessionSnapshotBuilder.",
      );
    }

    this.governanceEvaluator =
      governanceEvaluator;

    this.evidenceCoordinator =
      evidenceCoordinator;

    this.sessionSnapshotBuilder =
      sessionSnapshotBuilder;

    this.lifecycleCoordinatorFactory =
      lifecycleCoordinatorFactory;

    this.contextStore =
      contextStore;

    this.contextContributionApplier =
      contextContributionApplier;

    this.workspaceRegistry =
      workspaceRegistry;

    this.workspaceCoordinator =
      workspaceCoordinator;

    this.workspaceActivationReport =
      workspaceActivationReport;

    this.dispatcher =
      new ContractDispatcher({
        managerRegistry,
      });

    Object.freeze(this);
  }

  async dispatch(requestContract) {
    const lifecycleCoordinator =
      this.lifecycleCoordinatorFactory();

    lifecycleCoordinator.transition({
      contractId:
        requestContract.metadata.contractId,
      description:
        "Runtime planning started.",
      provenance:
        requestContract.provenance,
      toState:
        "planning",
      initiatingCause:
        "manager-request-received",
      authorityDecision:
        requestContract.payload.grantedAuthority,
      governanceDecision:
        undefined,
      evidenceReferences:
        [],
      correlationIdentity:
        requestContract.provenance.correlationId,
      contextVersion:
        requestContract.provenance.contextVersion,
    });

    lifecycleCoordinator.transition({
      contractId:
        requestContract.metadata.contractId,
      description:
        "Runtime authority evaluation started.",
      provenance:
        requestContract.provenance,
      toState:
        "awaiting-authority",
      initiatingCause:
        "planning-complete",
      authorityDecision:
        requestContract.payload.grantedAuthority,
      governanceDecision:
        undefined,
      evidenceReferences:
        [],
      correlationIdentity:
        requestContract.provenance.correlationId,
      contextVersion:
        requestContract.provenance.contextVersion,
    });

    lifecycleCoordinator.transition({
      contractId:
        requestContract.metadata.contractId,
      description:
        "Runtime execution started.",
      provenance:
        requestContract.provenance,
      toState:
        "executing",
      initiatingCause:
        "authority-gate-complete",
      authorityDecision:
        requestContract.payload.grantedAuthority,
      governanceDecision:
        undefined,
      evidenceReferences:
        [],
      correlationIdentity:
        requestContract.provenance.correlationId,
      contextVersion:
        requestContract.provenance.contextVersion,
    });

    let outcome =
      await this.dispatcher.dispatch(
        requestContract,
      );

    const evidenceCoordination =
      this.evidenceCoordinator.process({
        outcome,
      });

    const acceptedEvidenceReferences =
      evidenceCoordination.acceptedEvidenceReferences
        .map(
          (reference) =>
            reference.evidenceId,
        );

    lifecycleCoordinator.transition({
      contractId:
        requestContract.metadata.contractId,
      description:
        "Runtime validation started.",
      provenance:
        requestContract.provenance,
      toState:
        "validating",
      initiatingCause:
        "execution-complete",
      authorityDecision:
        requestContract.payload.grantedAuthority,
      governanceDecision:
        undefined,
      evidenceReferences:
        acceptedEvidenceReferences,
      correlationIdentity:
        requestContract.provenance.correlationId,
      contextVersion:
        requestContract.provenance.contextVersion,
    });

    lifecycleCoordinator.transition({
      contractId:
        requestContract.metadata.contractId,
      description:
        "Runtime governance started.",
      provenance:
        requestContract.provenance,
      toState:
        "governing",
      initiatingCause:
        "validation-complete",
      authorityDecision:
        requestContract.payload.grantedAuthority,
      governanceDecision:
        undefined,
      evidenceReferences:
        acceptedEvidenceReferences,
      correlationIdentity:
        requestContract.provenance.correlationId,
      contextVersion:
        requestContract.provenance.contextVersion,
    });

    const governanceDecision =
      this.governanceEvaluator.evaluate({
        outcome,
        currentContext:
          this.contextStore.getCurrent(),
        evidenceReferences:
          acceptedEvidenceReferences,
      });

    if (
      governanceDecision.decision === "approved" &&
      outcome.payload.contextContribution
    ) {
      lifecycleCoordinator.transition({
        contractId:
          requestContract.metadata.contractId,
        description:
          "Runtime context update started.",
        provenance:
          requestContract.provenance,
        toState:
          "updating-context",
        initiatingCause:
          "governance-approved",
        authorityDecision:
          requestContract.payload.grantedAuthority,
        governanceDecision,
        evidenceReferences:
          acceptedEvidenceReferences,
        correlationIdentity:
          requestContract.provenance.correlationId,
        contextVersion:
          requestContract.provenance.contextVersion,
      });

      const updatedContext =
        this.contextContributionApplier.apply({
          currentContext:
            this.contextStore.getCurrent(),
          managerIdentity:
            outcome.payload.managerIdentity,
          contextContribution:
            outcome.payload.contextContribution,
          evidenceReferences:
            acceptedEvidenceReferences,
          governanceDecision,
        });

      this.contextStore.replaceContext(
        updatedContext,
      );

      lifecycleCoordinator.transition({
        contractId:
          requestContract.metadata.contractId,
        description:
          "Runtime lifecycle returned to ready.",
        provenance:
          requestContract.provenance,
        toState:
          "ready",
        initiatingCause:
          "context-update-complete",
        authorityDecision:
          requestContract.payload.grantedAuthority,
        governanceDecision,
        evidenceReferences:
          acceptedEvidenceReferences,
        correlationIdentity:
          requestContract.provenance.correlationId,
        contextVersion:
          requestContract.provenance.contextVersion,
      });
    }

    return outcome;
  }

  createSessionSnapshot({
    snapshotIdentity,
    provenance,
    acceptedEvidence = [],
    environment = {},
  }) {
    return this.sessionSnapshotBuilder({
      snapshotIdentity,
      provenance,
      acceptedEvidence,
      environment,
    });
  }
}
