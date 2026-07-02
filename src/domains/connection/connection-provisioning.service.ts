import type {
  ConnectionProvisioningInput,
  ConnectionProvisioningResult,
} from "./connection-provisioning.types";

import {
  toConnectionProvisioningResult,
} from "./connection-provisioning.types";

export class ConnectionProvisioningService {
  provision(
    input: ConnectionProvisioningInput,
  ): ConnectionProvisioningResult {
    if (
      input.connection.credentialReferenceId &&
      input.connection.credentialReferenceId !== input.credentialReference.id
    ) {
      throw new Error(
        "Connection credential reference does not match credential reference.",
      );
    }

    if (
      input.institutionReference.connectionId !== input.connection.id
    ) {
      throw new Error(
        "Institution reference does not belong to the connection.",
      );
    }

    return toConnectionProvisioningResult(input);
  }
}
