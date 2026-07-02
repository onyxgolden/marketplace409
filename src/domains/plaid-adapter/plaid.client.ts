import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

import type {
  PlaidConfig,
} from "./plaid.config";

import {
  getPlaidConfig,
} from "./plaid.config";

export type PlaidLinkTokenRequest = {
  userId: string;
  clientName: string;
  language: string;
  countryCodes: CountryCode[];
  products: Products[];
};

export type PlaidPublicTokenExchangeRequest = {
  publicToken: string;
};

export type PlaidPublicTokenExchangeResult = {
  accessToken: string;
  itemId: string;
};

type PlaidLinkTokenClient = Pick<PlaidApi, "linkTokenCreate">;
type PlaidPublicTokenExchangeClient = Pick<PlaidApi, "itemPublicTokenExchange">;

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

export async function createPlaidLinkToken(
  client: PlaidLinkTokenClient,
  request: PlaidLinkTokenRequest,
): Promise<string> {
  const response = await client.linkTokenCreate({
    user: {
      client_user_id: request.userId,
    },
    client_name: request.clientName,
    language: request.language,
    country_codes: request.countryCodes,
    products: request.products,
  });

  return response.data.link_token;
}

export async function exchangePlaidPublicToken(
  client: PlaidPublicTokenExchangeClient,
  request: PlaidPublicTokenExchangeRequest,
): Promise<PlaidPublicTokenExchangeResult> {
  const response = await client.itemPublicTokenExchange({
    public_token: request.publicToken,
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}
