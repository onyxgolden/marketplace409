// --- The authoritative contract ---
//
// ConnectionProvider.importDataPayload() (see connection-provider.types.ts) MUST return
// already-canonical accounts/balances/transactions -- the exact shapes defined in
// src/domains/financial-account, src/domains/account-balance, and src/domains/transaction
// respectively, produced by that provider's own mapper (e.g. PlaidFinancialAccountMapper,
// StripeFinancialConnectionsAccountMapper). It must NEVER return raw, provider-specific objects
// (a raw Plaid or Stripe account/balance/transaction shape) here -- every provider maps to
// canonical form itself, once, inside importDataPayload.
//
// Every downstream consumer of this payload (FinancialAccountImportService.importCanonicalAccounts,
// AccountBalanceImportService.importCanonicalBalances, TransactionImportService.importCanonicalTransactionsForAccount,
// and both ConnectionImportExecutionCoordinator and the Stripe Financial Connections webhook route
// that call them) trusts this and does NOT map the payload again. A caller that maps a SECOND time
// (as ConnectionImportExecutionCoordinator used to, before this contract was made explicit)
// corrupts every field a canonical shape has that a raw provider shape does not share the same
// name for (providerAccountId vs. accountId, currencyCode vs. isoCurrencyCode, and so on) --
// silently, since nothing enforced the shape mismatch. See
// src/domains/connection/__tests__/connection-provider-payload-contract.test.ts for the standing
// regression test proving both Plaid's and Stripe's real importDataPayload output survives this
// pipeline unchanged.
//
// This module defines its own minimal structural interfaces (CanonicalFinancialAccountLike, etc.)
// rather than importing FinancialAccount/AccountBalance/Transaction directly from their own
// domains: financial-account and account-balance already import FROM this connection domain (for
// AccountImportResult), so importing back from here would be circular. Every field on the real
// canonical types below is a superset of what's captured here; the real types remain structurally
// assignable to these without any cast.
export type CanonicalFinancialAccountLike = Readonly<{
  id: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  institutionId: string;
  name: string;
  type: string;
  currencyCode: string;
}>;

export type CanonicalAccountBalanceLike = Readonly<{
  id: string;
  financialAccountId: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  currencyCode: string;
  currentBalanceCents: number;
  availableBalanceCents: number | null;
  asOf: string;
}>;

export type CanonicalTransactionLike = Readonly<{
  id: string;
  financialAccountId: string;
  connectionId: string;
  provider: string;
  providerTransactionId: string;
  providerAccountId: string;
  amountCents: number;
  currencyCode: string;
  date: string;
  description: string;
  pending: boolean;
}>;

export type ConnectionImportPayload = Readonly<{
  provider: string;
  connectionId: string;

  accounts: readonly CanonicalFinancialAccountLike[];
  balances: readonly CanonicalAccountBalanceLike[];
  transactions: readonly CanonicalTransactionLike[];

  occurredAt: string;
}>;
