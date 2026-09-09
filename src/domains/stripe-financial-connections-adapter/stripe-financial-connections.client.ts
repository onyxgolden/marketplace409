// Thin wrapper around the Stripe Node SDK's financialConnections resource -- mirrors
// plaid.client.ts's role (isolate every raw provider SDK call in one small, mockable module) so
// the adapter/provider file never talks to the Stripe SDK directly.
//
// Deliberately takes an already-constructed Stripe client rather than building its own -- see
// stripe-financial-connections.provider.ts's header comment for why: FORGE has exactly one
// configured Stripe SDK instance (StripeBillingProvider's), and this reuses it rather than
// creating a second one.
//
// Every method/param/field referenced below is validated against the ACTUALLY INSTALLED
// stripe@22.5.0 type declarations (node_modules/stripe/cjs/resources/FinancialConnections/*.d.ts,
// node_modules/stripe/cjs/resources/Events.d.ts) and, where noted, against Stripe's live public
// API reference/guide pages -- not recollection. See each function's own comment for its specific
// evidence. stripe-financial-connections.client.test.ts includes a compile-time contract test
// (no `any`, no cast) proving a real `Stripe` instance satisfies StripeFinancialConnectionsClient.
import type Stripe from "stripe";

// Real Stripe SDK resource types picked by exactly the methods this module calls -- not
// `Pick<Stripe, "financialConnections" | "customers">` wholesale, since that would also pull in
// every OTHER method on those resources (listOwners, disconnect params variants, etc.) that
// nothing here uses, without adding any real safety. Every method signature below is copied
// verbatim from the installed .d.ts files, so a real Stripe client satisfies this with no cast,
// and a test double that gets a parameter or return shape wrong fails to type-check as this
// interface, not just at runtime.
export type StripeFinancialConnectionsClient = {
  financialConnections: {
    sessions: {
      create: Stripe.FinancialConnections.SessionResource["create"];
      retrieve: Stripe.FinancialConnections.SessionResource["retrieve"];
    };
    accounts: {
      subscribe: Stripe.FinancialConnections.AccountResource["subscribe"];
      unsubscribe: Stripe.FinancialConnections.AccountResource["unsubscribe"];
      disconnect: Stripe.FinancialConnections.AccountResource["disconnect"];
      retrieve: Stripe.FinancialConnections.AccountResource["retrieve"];
      refresh: Stripe.FinancialConnections.AccountResource["refresh"];
    };
    transactions: {
      list: Stripe.FinancialConnections.TransactionResource["list"];
    };
  };
  customers: {
    create: Stripe.CustomerResource["create"];
  };
};

const US_ONLY_COUNTRIES = ["US"] as const;

// permissions: "ownership" is deliberately never requested -- FORGE's approved Stripe application
// scope does not include account-ownership data. "payment_method" is requested alongside
// balances/transactions because the approved scope explicitly covers "optimize/accept bank
// payments" -- a Financial Connections account authorized this way can also back a PaymentIntent
// later without a second, separate authorization.
//
// Both permissions and prefetch values are typed against
// Stripe.FinancialConnections.SessionCreateParams.Permission / .Prefetch (Sessions.d.ts) --
// 'balances' | 'ownership' | 'payment_method' | 'transactions' for permissions,
// 'balances' | 'ownership' | 'transactions' for prefetch. A typo or unsupported value here is now
// a compile error, not a runtime surprise.
const REQUESTED_PERMISSIONS: readonly Stripe.FinancialConnections.SessionCreateParams.Permission[] = ["payment_method", "balances", "transactions"];
const PREFETCH: readonly Stripe.FinancialConnections.SessionCreateParams.Prefetch[] = ["balances", "transactions"];

export async function createFinancialConnectionsSession(
  client: StripeFinancialConnectionsClient,
  input: { customerId: string },
): Promise<{ id: string; clientSecret: string }> {
  const session = await client.financialConnections.sessions.create({
    account_holder: { type: "customer", customer: input.customerId },
    permissions: [...REQUESTED_PERMISSIONS],
    filters: { countries: [...US_ONLY_COUNTRIES] },
    prefetch: [...PREFETCH],
  });

  if (!session.client_secret) {
    throw new Error("Stripe did not return a Financial Connections Session client secret.");
  }

  return { id: session.id, clientSecret: session.client_secret };
}

export type StripeFinancialConnectionsSessionAccount = {
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
  last4: string | null;
  category: Stripe.FinancialConnections.Account.Category;
  subcategory: Stripe.FinancialConnections.Account.Subcategory;
  status: Stripe.FinancialConnections.Account.Status;
};

// Server-side retrieval is the ONLY source of truth this adapter ever uses for "which accounts
// did this session actually authorize" -- see the /complete route, which never trusts account
// data the browser reports back from Stripe.js. accountHolderCustomerId is returned so the
// caller can verify this session was created for the expected owner's own Stripe Customer, not
// substituted/guessed by a client supplying an arbitrary session id.
//
// No `expand` param: Session.accounts is already a plain, always-populated `ApiList<Account>`
// field on the object (Sessions.d.ts) -- not a reference gated behind expand. Requesting
// `expand: ["accounts"]` was removed; it targeted a field that doesn't need or support expansion.
export async function retrieveFinancialConnectionsSession(
  client: StripeFinancialConnectionsClient,
  input: { sessionId: string },
): Promise<{
  id: string;
  accountHolderCustomerId: string | null;
  accounts: readonly StripeFinancialConnectionsSessionAccount[];
}> {
  const session = await client.financialConnections.sessions.retrieve(input.sessionId);

  const holder = session.account_holder;
  const customerRef = holder?.type === "customer" ? holder.customer : null;
  const accountHolderCustomerId =
    typeof customerRef === "string" ? customerRef : customerRef?.id ?? null;

  const accounts = session.accounts.data.map((account) => ({
    accountId: account.id,
    displayName: account.display_name,
    institutionName: account.institution_name,
    last4: account.last4,
    category: account.category,
    subcategory: account.subcategory,
    status: account.status,
  }));

  return { id: session.id, accountHolderCustomerId, accounts };
}

// Enables Stripe's daily automatic transaction refresh going forward. Balances are deliberately
// NOT subscribed here -- per AccountSubscribeParams.features (Accounts.d.ts), the ONLY
// subscribable feature is 'transactions'; there is no balance-subscribe option at all. Balance is
// refreshed on demand only (subject to next_refresh_available_at) via the Refresh API.
export async function subscribeFinancialConnectionsAccount(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<void> {
  await client.financialConnections.accounts.subscribe(input.accountId, {
    features: ["transactions"],
  });
}

export async function unsubscribeFinancialConnectionsAccount(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<void> {
  await client.financialConnections.accounts.unsubscribe(input.accountId, {
    features: ["transactions"],
  });
}

// Called only when the user explicitly removes the connection -- distinct from unsubscribe
// (which just stops future automatic refreshes while leaving the account's authorization intact
// on Stripe's side). Disconnect fully revokes FORGE's access to this account.
export async function disconnectFinancialConnectionsAccount(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<void> {
  await client.financialConnections.accounts.disconnect(input.accountId);
}

export type StripeFinancialConnectionsAccountState = {
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
  last4: string | null;
  category: Stripe.FinancialConnections.Account.Category;
  subcategory: Stripe.FinancialConnections.Account.Subcategory;
  status: Stripe.FinancialConnections.Account.Status;
  // null when Stripe has not yet returned ANY balance for this account (e.g. never refreshed) --
  // distinct from a genuinely absent currency-keyed amount within a present balance object, which
  // is now treated as an error rather than silently defaulted (see extractCurrentBalance below).
  balance: {
    currentCents: number;
    availableCents: number | null;
    currency: string;
    asOf: string;
    type: Stripe.FinancialConnections.Account.Balance.Type;
  } | null;
  balanceRefreshStatus: Stripe.FinancialConnections.Account.BalanceRefresh.Status | null;
  nextBalanceRefreshAvailableAt: string | null;
  transactionRefreshStatus: Stripe.FinancialConnections.Account.TransactionRefresh.Status | null;
  transactionRefreshId: string | null;
};

// Balance.current[currency] is the authoritative "current balance" figure for BOTH cash and
// credit accounts (Accounts.d.ts: "The balances owed to (or by) the account holder... A positive
// amount indicates money owed TO the account holder. A negative amount indicates money owed BY
// the account holder.") -- this is distinct from cash.available[currency] ("funds available...
// typically the current balance after subtracting outbound pending / adding inbound pending") and
// from credit.used[currency] (how much of a credit line has been drawn, not itself "the balance").
// Earlier drafts of this adapter conflated these three fields; this reads `current` for
// currentCents unconditionally, and only reads `cash.available` for availableCents when the
// balance type is "cash" -- credit.used is not read into currentCents/availableCents at all
// (negating it as a stand-in for "current balance" was wrong; there is no canonical-model field
// to put "credit used" in today -- see the correction report for that open item, not invented
// here).
//
// Never defaults an absent currency-keyed amount to 0: a genuinely missing amount is a data
// problem worth failing loudly on, not a silent "$0" that would misrepresent a real balance.
function extractCurrentBalance(
  balance: Stripe.FinancialConnections.Account.Balance,
  currency: string,
): { currentCents: number; availableCents: number | null } {
  const currentCents = balance.current[currency];
  if (currentCents === undefined) {
    throw new Error(`Stripe balance has no "current" amount for currency "${currency}".`);
  }
  const availableCents = balance.type === "cash" ? balance.cash?.available?.[currency] ?? null : null;
  return { currentCents, availableCents };
}

function resolveBalanceCurrency(balance: Stripe.FinancialConnections.Account.Balance): string {
  const currentCurrencies = Object.keys(balance.current);
  if (currentCurrencies.length === 1) return currentCurrencies[0];
  if (currentCurrencies.length === 0) {
    throw new Error("Stripe balance.current has no currency keys.");
  }
  // Financial Connections accounts are documented as single-currency; more than one key here is
  // unexpected and worth failing on rather than silently guessing which one is "the" balance.
  throw new Error(`Stripe balance.current has multiple currency keys (${currentCurrencies.join(", ")}); cannot determine which is authoritative.`);
}

export async function retrieveFinancialConnectionsAccount(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<StripeFinancialConnectionsAccountState> {
  // No `expand` param: Account.balance is already a plain, always-present field
  // (`balance: Account.Balance | null`, Accounts.d.ts) -- not gated behind expand. Requesting
  // `expand: ["balance"]` was removed for the same reason session `expand: ["accounts"]` was.
  const account = await client.financialConnections.accounts.retrieve(input.accountId);

  let balance: StripeFinancialConnectionsAccountState["balance"] = null;
  if (account.balance) {
    const currency = resolveBalanceCurrency(account.balance);
    const amounts = extractCurrentBalance(account.balance, currency);
    balance = {
      currentCents: amounts.currentCents,
      availableCents: amounts.availableCents,
      currency: currency.toUpperCase(),
      asOf: new Date(account.balance.as_of * 1000).toISOString(),
      type: account.balance.type,
    };
  }

  return {
    accountId: account.id,
    displayName: account.display_name,
    institutionName: account.institution_name,
    last4: account.last4,
    category: account.category,
    subcategory: account.subcategory,
    status: account.status,
    balance,
    balanceRefreshStatus: account.balance_refresh?.status ?? null,
    nextBalanceRefreshAvailableAt: account.balance_refresh?.next_refresh_available_at
      ? new Date(account.balance_refresh.next_refresh_available_at * 1000).toISOString()
      : null,
    transactionRefreshStatus: account.transaction_refresh?.status ?? null,
    transactionRefreshId: account.transaction_refresh?.id ?? null,
  };
}

// Honors next_refresh_available_at at the call site (see the provider's manual-sync path) -- this
// function itself just issues the refresh request; it does not check the cooldown, so callers
// must check retrieveFinancialConnectionsAccount's nextBalanceRefreshAvailableAt first. Per
// Stripe's own guide ("Refreshes aren't allowed on inactive accounts"), never call this for a
// non-active account either.
export async function refreshFinancialConnectionsAccountBalance(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<void> {
  await client.financialConnections.accounts.refresh(input.accountId, {
    features: ["balance"],
  });
}

export type StripeFinancialConnectionsTransactionPage = {
  transactions: readonly {
    transactionId: string;
    accountId: string;
    amount: number;
    currency: string;
    description: string;
    status: Stripe.FinancialConnections.Transaction.Status;
    transactedAt: string;
    statusTransitionedAt: string | null;
    transactionRefreshId: string;
  }[];
  hasMore: boolean;
  lastTransactionId: string | null;
};

// transactionRefreshAfter maps directly to Stripe's own documented incremental-sync parameter,
// TransactionListParams.transaction_refresh.after ("Return results where the transactions were
// created or updated by a refresh that took place after this refresh (non-inclusive)") --
// Transactions.d.ts, and matches the pattern in Stripe's own "Retrieving transactions since last
// refresh" guide (docs.stripe.com/financial-connections/transactions) verbatim: pass the
// PREVIOUSLY observed account.transaction_refresh.id from the last successfully processed
// refreshed_transactions webhook. This is authoritative -- unlike the transacted_at-based
// approach this adapter used before, which could permanently skip a transaction whose
// transacted_at predates the cursor but which posted/updated later.
export async function listFinancialConnectionsTransactionsPage(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string; transactionRefreshAfter?: string; startingAfter?: string; limit?: number },
): Promise<StripeFinancialConnectionsTransactionPage> {
  const page = await client.financialConnections.transactions.list({
    account: input.accountId,
    limit: input.limit ?? 100,
    ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
    ...(input.transactionRefreshAfter ? { transaction_refresh: { after: input.transactionRefreshAfter } } : {}),
  });

  const transactions = page.data.map((transaction) => ({
    transactionId: transaction.id,
    accountId: transaction.account,
    amount: transaction.amount,
    currency: transaction.currency,
    description: transaction.description,
    status: transaction.status,
    transactedAt: new Date(transaction.transacted_at * 1000).toISOString().slice(0, 10),
    statusTransitionedAt: transaction.status_transitions.posted_at
      ? new Date(transaction.status_transitions.posted_at * 1000).toISOString()
      : transaction.status_transitions.void_at
        ? new Date(transaction.status_transitions.void_at * 1000).toISOString()
        : null,
    transactionRefreshId: transaction.transaction_refresh,
  }));

  return {
    transactions,
    hasMore: page.has_more,
    lastTransactionId: transactions.length > 0 ? transactions[transactions.length - 1].transactionId : null,
  };
}

// Preserves starting_after pagination WITHIN a single transaction_refresh.after-filtered query --
// the two parameters are orthogonal (one narrows by refresh recency, the other pages through
// whatever that narrowed result set contains), exactly as PaginationParams + the
// transaction_refresh filter coexist on TransactionListParams (Transactions.d.ts).
export async function listAllFinancialConnectionsTransactions(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string; transactionRefreshAfter?: string },
): Promise<StripeFinancialConnectionsTransactionPage["transactions"]> {
  const all: StripeFinancialConnectionsTransactionPage["transactions"][number][] = [];
  let startingAfter: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await listFinancialConnectionsTransactionsPage(client, {
      accountId: input.accountId,
      transactionRefreshAfter: input.transactionRefreshAfter,
      startingAfter,
    });
    all.push(...page.transactions);
    hasMore = page.hasMore;
    startingAfter = page.lastTransactionId ?? undefined;
    if (!startingAfter) hasMore = false;
  }

  return all;
}

// One Stripe Customer per FORGE workspace owner, on the platform account (no stripeAccount
// param) -- distinct from the Connect-scoped Customers createStripeBillingProvider already
// creates for tenants/borrowers inside a landlord's/borrower's connected account, which are the
// wrong identity for this purpose entirely. Callers only ever create one when
// credentialVaultService has no existing vaulted customer id for this owner -- see the provider.
export async function createStripeCustomerForOwner(
  client: StripeFinancialConnectionsClient,
  input: { ownerId: string },
): Promise<{ customerId: string }> {
  const customer = await client.customers.create({
    metadata: { forge_owner_id: input.ownerId, forge_purpose: "financial_connections_account_holder" },
  });

  return { customerId: customer.id };
}
