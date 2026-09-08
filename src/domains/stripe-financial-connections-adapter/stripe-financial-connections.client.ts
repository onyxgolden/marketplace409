// Thin wrapper around the Stripe Node SDK's financialConnections resource -- mirrors
// plaid.client.ts's role (isolate every raw provider SDK call in one small, mockable module) so
// the adapter/provider file never talks to the Stripe SDK directly.
//
// Deliberately takes an already-constructed Stripe client rather than building its own -- see
// stripe-financial-connections.provider.ts's header comment for why: FORGE has exactly one
// configured Stripe SDK instance (StripeBillingProvider's), and this reuses it rather than
// creating a second one.
//
// API surface used here (Stripe Node SDK v22, financialConnections resource) is written against
// this adapter author's best understanding of Stripe's current documented Financial Connections
// API at the time this was built -- worth a final check against Stripe's live docs/SDK types
// before Jason's first real production authorization session (a separate, already-required
// approval gate; not bypassed by this comment).
// A hand-written, minimal structural type for exactly the SDK surface this module calls --
// deliberately NOT `Pick<Stripe, "financialConnections" | "customers">`. Stripe's own resource
// types are large and exact; picking whole namespaces would force every caller (including every
// test in this file) to satisfy far more than what's actually used, and would tie this file
// tightly to Stripe SDK type shapes this adapter's author could not fully verify from memory.
// Loose `any`-ish return types here are intentional: each function below immediately narrows what
// it reads into this module's own normalized return type, so an incorrect assumption about
// Stripe's exact response shape surfaces as a runtime/test failure in ONE place, not a type error
// that could be silenced by a cast.
export type StripeFinancialConnectionsClient = {
  financialConnections: {
    sessions: {
      create(params: any): Promise<any>;
      retrieve(id: string, params?: any): Promise<any>;
    };
    accounts: {
      subscribe(id: string, params: any): Promise<any>;
      unsubscribe(id: string, params: any): Promise<any>;
      disconnect(id: string): Promise<any>;
      retrieve(id: string, params?: any): Promise<any>;
      refresh(id: string, params: any): Promise<any>;
    };
    transactions: {
      list(params: any): Promise<any>;
    };
  };
  customers: {
    create(params: any): Promise<any>;
  };
};

const US_ONLY_COUNTRIES = ["US"] as const;

// permissions: "ownership" is deliberately never requested -- FORGE's approved Stripe application
// scope does not include account-ownership data. "payment_method" is requested alongside
// balances/transactions because the approved scope explicitly covers "optimize/accept bank
// payments" -- a Financial Connections account authorized this way can also back a PaymentIntent
// later without a second, separate authorization.
const REQUESTED_PERMISSIONS = ["payment_method", "balances", "transactions"] as const;
const PREFETCH = ["balances", "transactions"] as const;

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
  category: string;
  subcategory: string | null;
  status: string;
  currency: string | null;
};

// Server-side retrieval is the ONLY source of truth this adapter ever uses for "which accounts
// did this session actually authorize" -- see the /complete route, which never trusts account
// data the browser reports back from Stripe.js. accountHolderCustomerId is returned so the
// caller can verify this session was created for the expected owner's own Stripe Customer, not
// substituted/guessed by a client supplying an arbitrary session id.
export async function retrieveFinancialConnectionsSession(
  client: StripeFinancialConnectionsClient,
  input: { sessionId: string },
): Promise<{
  id: string;
  accountHolderCustomerId: string | null;
  accounts: readonly StripeFinancialConnectionsSessionAccount[];
}> {
  const session = await client.financialConnections.sessions.retrieve(input.sessionId, {
    expand: ["accounts"],
  });

  const holder = session.account_holder;
  const customerRef = holder?.type === "customer" ? holder.customer : null;
  const accountHolderCustomerId =
    typeof customerRef === "string" ? customerRef : customerRef?.id ?? null;

  const accounts = (session.accounts?.data ?? []).map((account) => ({
    accountId: account.id,
    displayName: account.display_name ?? null,
    institutionName: account.institution_name ?? null,
    last4: account.last4 ?? null,
    category: account.category,
    subcategory: account.subcategory ?? null,
    status: account.status,
    currency: extractBalanceCurrency(account.balance),
  }));

  return { id: session.id, accountHolderCustomerId, accounts };
}

// Enables Stripe's daily automatic transaction refresh going forward. Balances are deliberately
// NOT subscribed here -- per Stripe's own model, only `transactions` supports an ongoing
// subscription; balance is refreshed on demand (subject to next_refresh_available_at) or whenever
// Stripe otherwise decides to, never on a FORGE-managed schedule.
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
  status: string;
  balance: {
    currentCents: number | null;
    availableCents: number | null;
    currency: string | null;
    asOf: string;
  } | null;
  // Loosely typed (not a strict literal union) rather than fought against the SDK's own exact
  // Status type, which this adapter's author could not fully confirm from memory -- the balance
  // mapper's own runtime check against the literal string "succeeded" is the real gate, not this
  // type.
  balanceRefreshStatus: string | null;
  nextBalanceRefreshAvailableAt: string | null;
};

// Stripe's Balance object nests amounts under `cash`/`credit`, each keyed by lowercase currency
// code (e.g. balance.cash.available.usd) rather than a flat amount+currency pair -- this picks
// the one currency key present (Financial Connections accounts are single-currency) and returns
// it alongside the resolved amount.
function extractBalanceAmounts(balance: { cash?: { available?: Record<string, number> }; credit?: { used?: Record<string, number> } } | null | undefined): {
  currentCents: number | null;
  availableCents: number | null;
  currency: string | null;
} {
  const cash = balance?.cash?.available ?? null;
  const credit = balance?.credit?.used ?? null;
  const currency = cash ? Object.keys(cash)[0] ?? null : credit ? Object.keys(credit)[0] ?? null : null;
  if (!currency) return { currentCents: null, availableCents: null, currency: null };
  if (cash) return { currentCents: cash[currency], availableCents: cash[currency], currency: currency.toUpperCase() };
  return { currentCents: -(credit as Record<string, number>)[currency], availableCents: null, currency: currency.toUpperCase() };
}

function extractBalanceCurrency(balance: { cash?: { available?: Record<string, number> }; credit?: { used?: Record<string, number> } } | null | undefined): string | null {
  return extractBalanceAmounts(balance).currency;
}

export async function retrieveFinancialConnectionsAccount(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string },
): Promise<StripeFinancialConnectionsAccountState> {
  const account = await client.financialConnections.accounts.retrieve(input.accountId, {
    expand: ["balance"],
  });

  const balance = account.balance;
  const amounts = extractBalanceAmounts(balance);

  return {
    accountId: account.id,
    status: account.status,
    balance: balance
      ? {
          currentCents: amounts.currentCents,
          availableCents: amounts.availableCents,
          currency: amounts.currency,
          asOf: new Date((balance.as_of ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        }
      : null,
    balanceRefreshStatus: account.balance_refresh?.status ?? null,
    nextBalanceRefreshAvailableAt: account.balance_refresh?.next_refresh_available_at
      ? new Date(account.balance_refresh.next_refresh_available_at * 1000).toISOString()
      : null,
  };
}

// Honors next_refresh_available_at at the call site (see the provider's manual-sync path) -- this
// function itself just issues the refresh request; it does not check the cooldown, so callers
// must check retrieveFinancialConnectionsAccount's nextBalanceRefreshAvailableAt first.
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
    status: "posted" | "pending" | "void";
    transactedAt: string;
    statusTransitionedAt: string | null;
  }[];
  hasMore: boolean;
  lastTransactionId: string | null;
};

// transactedAtGte is an optimization only (skip re-fetching data already known to be older than
// the last successfully processed refresh's watermark) -- it is never relied on for correctness.
// Every caller still upserts idempotently by transactionId regardless of this filter.
export async function listFinancialConnectionsTransactionsPage(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string; transactedAtGte?: number; startingAfter?: string; limit?: number },
): Promise<StripeFinancialConnectionsTransactionPage> {
  const page = await client.financialConnections.transactions.list({
    account: input.accountId,
    limit: input.limit ?? 100,
    ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
    ...(input.transactedAtGte ? { transacted_at: { gte: input.transactedAtGte } } : {}),
  });

  const transactions = page.data.map((transaction) => ({
    transactionId: transaction.id,
    accountId: input.accountId,
    amount: transaction.amount,
    currency: transaction.currency,
    description: transaction.description,
    status: transaction.status,
    transactedAt: new Date(transaction.transacted_at * 1000).toISOString().slice(0, 10),
    statusTransitionedAt: transaction.status_transitions?.posted_at
      ? new Date(transaction.status_transitions.posted_at * 1000).toISOString()
      : transaction.status_transitions?.void_at
        ? new Date(transaction.status_transitions.void_at * 1000).toISOString()
        : null,
  }));

  return {
    transactions,
    hasMore: page.has_more,
    lastTransactionId: transactions.length > 0 ? transactions[transactions.length - 1].transactionId : null,
  };
}

export async function listAllFinancialConnectionsTransactions(
  client: StripeFinancialConnectionsClient,
  input: { accountId: string; transactedAtGte?: number },
): Promise<StripeFinancialConnectionsTransactionPage["transactions"]> {
  const all: StripeFinancialConnectionsTransactionPage["transactions"][number][] = [];
  let startingAfter: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await listFinancialConnectionsTransactionsPage(client, {
      accountId: input.accountId,
      transactedAtGte: input.transactedAtGte,
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
