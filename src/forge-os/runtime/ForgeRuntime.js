import {
  ContractDispatcher,
} from "../kernel/index.js";

export class ForgeRuntime {
  constructor({
    managerRegistry,
    contextStore,
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

    this.contextStore =
      contextStore;

    this.dispatcher =
      new ContractDispatcher({
        managerRegistry,
      });

    Object.freeze(this);
  }

  async dispatch(requestContract) {
    return this.dispatcher.dispatch(
      requestContract,
    );
  }
}
