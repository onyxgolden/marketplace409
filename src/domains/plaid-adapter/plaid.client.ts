import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

import type {
  PlaidConfig,
} from "./plaid.config";

import {
  getPlaidConfig,
} from "./plaid.config";

export function createPlaidClient(
  config: PlaidConfig = getPlaidConfig(),
): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[config.environment],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
