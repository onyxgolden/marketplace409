import {
  validateContractStructure,
} from "../../contracts/v1/core/index.js";

export class ContractDispatcher {
  constructor({
    managerRegistry,
  }) {
    if (!managerRegistry) {
      throw new Error(
        "ContractDispatcher requires a managerRegistry.",
      );
    }

    this.managerRegistry =
      managerRegistry;
  }

  async dispatch(requestContract) {
    const validation =
      validateContractStructure(
        requestContract,
      );

    if (!validation.valid) {
      throw new Error(
        "Request contract failed structural validation.",
      );
    }

    const capability =
      requestContract.payload
        .requestedCapability;

    const manager =
      this.managerRegistry.resolve(
        capability,
      );

    return await manager.execute(
      requestContract,
    );
  }
}
