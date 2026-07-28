import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from "plaid";

import type {
  AccountsGetResponse,
  TransactionsSyncResponse,
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

export type PlaidAccessTokenRequest = {
  accessToken: string;
};

export type PlaidTransactionsSyncRequest = {
  accessToken: string;
  cursor?: string;
};

export type PlaidTransactionUpdates = {
  added: TransactionsSyncResponse["added"];
  modified: TransactionsSyncResponse["modified"];
  removed: TransactionsSyncResponse["removed"];
  nextCursor: string;
};

export type PlaidAdapterClient = Partial<
  Pick<
    PlaidApi,
    | "linkTokenCreate"
    | "itemPublicTokenExchange"
    | "accountsGet"
    | "accountsBalanceGet"
    | "transactionsSync"
  >
>;

type PlaidLinkTokenClient =
  Pick<PlaidAdapterClient, "linkTokenCreate">;

type PlaidPublicTokenExchangeClient =
  Pick<PlaidAdapterClient, "itemPublicTokenExchange">;

type PlaidAccountsClient =
  Pick<PlaidAdapterClient, "accountsGet">;

type PlaidBalancesClient =
  Pick<PlaidAdapterClient, "accountsBalanceGet">;

type PlaidTransactionsSyncClient =
  Pick<PlaidAdapterClient, "transactionsSync">;

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

export async function getPlaidAccounts(
  client: PlaidAccountsClient,
  request: PlaidAccessTokenRequest,
): Promise<AccountsGetResponse> {
  const response = await client.accountsGet({
    access_token: request.accessToken,
  });

  return response.data;
}

export async function getPlaidBalances(
  client: PlaidBalancesClient,
  request: PlaidAccessTokenRequest,
): Promise<AccountsGetResponse> {
  const response = await client.accountsBalanceGet({
    access_token: request.accessToken,
  });

  return response.data;
}

export async function getPlaidTransactionsSync(
  client: PlaidTransactionsSyncClient,
  request: PlaidTransactionsSyncRequest,
): Promise<TransactionsSyncResponse> {
  const response = await client.transactionsSync({
    access_token: request.accessToken,
    ...(request.cursor !== undefined
      ? {
          cursor: request.cursor,
        }
      : {}),
  });

  return response.data;
}

export async function getAllPlaidTransactionUpdates(
  client: PlaidTransactionsSyncClient,
  request: PlaidTransactionsSyncRequest,
): Promise<PlaidTransactionUpdates> {
  const added: TransactionsSyncResponse["added"] = [];
  const modified: TransactionsSyncResponse["modified"] = [];
  const removed: TransactionsSyncResponse["removed"] = [];

  let cursor = request.cursor;
  let hasMore = true;

  while (hasMore) {
    const page = await getPlaidTransactionsSync(client, {
      accessToken: request.accessToken,
      ...(cursor !== undefined
        ? {
            cursor,
          }
        : {}),
    });

    added.push(...page.added);
    modified.push(...page.modified);
    removed.push(...page.removed);

    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  return {
    added,
    modified,
    removed,
    nextCursor: cursor ?? "",
  };
}
