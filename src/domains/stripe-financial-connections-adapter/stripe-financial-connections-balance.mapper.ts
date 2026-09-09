import {
  createAccountBalance,
} from "../account-balance";

import type {
  AccountBalance,
} from "../account-balance";

import type {
  StripeFinancialConnectionsBalance,
} from "./stripe-financial-connections-balance.types";

export class StripeFinancialConnectionsBalanceMapper {
  // Unlike PlaidAccountBalanceMapper, this does NOT multiply by 100 -- Stripe Financial
  // Connections balances are already integer cents (Stripe's convention across its whole API),
  // where Plaid returns decimal dollars. Applying Plaid's `Math.round(amount * 100)` here would
  // silently inflate every Stripe balance 100x.
  //
  // currentBalanceCents is taken directly from balance.currentCents (itself
  // Balance.current[currency], see stripe-financial-connections-balance.types.ts) -- never
  // defaulted to 0. A cash account's availableBalanceCents comes from Balance.cash.available
  // (already resolved by the client); a credit account's is null, since credit accounts have no
  // cash.available field at all and Balance.credit.used is a different figure (how much of the
  // line is drawn) that this mapper does not substitute in its place.
  //
  // Callers must only invoke this once refreshStatus === "succeeded" has already been checked --
  // see stripe-financial-connections.provider.ts's importDataPayload and the webhook route's
  // refreshed_balance handler, both of which skip calling this mapper entirely for a
  // failed/pending refresh rather than writing a misleading balance row. That is how this adapter
  // makes a stale/pending/failed refresh explicit: no new (potentially wrong) AccountBalance row
  // is ever written for one, and the previous successful balance's own `asOf` timestamp is left
  // as the honest, comparably-stale last-known value.
  map(
    balance: StripeFinancialConnectionsBalance,
    financialAccountId: string,
    connectionId: string,
    provider: string,
  ): AccountBalance {
    if (balance.refreshStatus !== "succeeded") {
      throw new Error(
        `Stripe balance for account ${balance.accountId} is not from a succeeded refresh (status: ${balance.refreshStatus ?? "none"}) and must not be mapped.`,
      );
    }

    return createAccountBalance({
      id: `account_balance_${provider}_${balance.accountId}_${balance.asOf}`,
      financialAccountId,
      connectionId,
      provider,
      providerAccountId: balance.accountId,
      currencyCode: balance.currency.toUpperCase(),
      currentBalanceCents: balance.currentCents,
      availableBalanceCents: balance.availableCents,
      asOf: balance.asOf,
      createdAt: balance.asOf,
    });
  }
}
