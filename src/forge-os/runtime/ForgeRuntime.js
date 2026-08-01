import {
  ContractDispatcher,
  GovernanceEvaluator,
  LifecycleCoordinator,
} from "../kernel/index.js";

export class ForgeRuntime {
  constructor({
    managerRegistry,
    contextStore,
    contextContributionApplier,
    governanceEvaluator = new GovernanceEvaluator(),
    lifecycleCoordinatorFactory =
      () => new LifecycleCoordinator(),
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

    this.governanceEvaluator =
      governanceEvaluator;

    this.lifecycleCoordinatorFactory =
      lifecycleCoordinatorFactory;

    this.contextStore =
      contextStore;

    this.contextContributionApplier =
      contextContributionApplier;

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

    const outcome =
      await this.dispatcher.dispatch(
        requestContract,
      );

    const governanceDecision =
      this.governanceEvaluator.evaluate({
        outcome,
        currentContext:
          this.contextStore.getCurrent(),
      });

    if (
      governanceDecision.decision === "approved" &&
      outcome.payload.contextContribution
    ) {
      const updatedContext =
        this.contextContributionApplier.apply({
          currentContext:
            this.contextStore.getCurrent(),
          managerIdentity:
            outcome.payload.managerIdentity,
          contextContribution:
            outcome.payload.contextContribution,
          evidenceReferences:
            outcome.payload.producedEvidence,
          governanceDecision,
        });

      this.contextStore.replaceContext(
        updatedContext,
      );
    }

    return outcome;
  }
}
