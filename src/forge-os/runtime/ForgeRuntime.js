import {
  ContractDispatcher,
} from "../kernel/index.js";

export class ForgeRuntime {
  constructor({
    managerRegistry,
    contextStore,
    contextContributionApplier,
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
    const outcome =
      await this.dispatcher.dispatch(
        requestContract,
      );

    if (
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
        });

      this.contextStore.replaceContext(
        updatedContext,
      );
    }

    return outcome;
  }
}
