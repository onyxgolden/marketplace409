import {
  ContractDispatcher,
} from "../kernel/index.js";

export class ForgeRuntime {
  constructor({
    managerRegistry,
  }) {
    if (!managerRegistry) {
      throw new Error(
        "ForgeRuntime requires a managerRegistry.",
      );
    }

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
