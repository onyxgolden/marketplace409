// FORGE load-times Slice 3 — dashboard diagnostic history loader.
//
// Pure fetch loop behind the "Read Model Diagnostic Layer" in
// ForgeDashboardClient. Loads EVERY page of
// /api/forge/dashboard/transactions before the history counts as loaded.
// A server that claims completeness while rows are still missing, a
// totalCount that changes mid-load, or a page stream that never ends is
// an error -- never a partial history presented as complete.
//
// Fix round 1: each page also checks transaction IDs for uniqueness
// across every page loaded so far. The server rebuilds the whole
// historical workspace per page, so a same-count delete+insert between
// pages can duplicate one transaction and omit another while the count
// still matches -- the duplicate is the detectable half of that swap.
// A duplicate is a changed-while-loading error: the caller reloads to
// retry from page 1, it never reports the history complete. An
// omission with no duplicate is NOT detectable from the client alone
// (it needs a server snapshot/generation); the loader reports only
// what it can prove -- unique, fully-counted pages -- and rejects
// everything else.

export async function loadAllDiagnosticTransactions({
  fetcher = fetch,
  pageSize = 1000,
} = {}) {
  const transactions = [];
  const seenTransactionIds = new Set();
  let totalCount = null;
  let totalPages = null;
  let page = 1;

  while (true) {
    const response = await fetcher(
      `/api/forge/dashboard/transactions?page=${page}&pageSize=${pageSize}`,
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload?.error ?? "Unable to load transaction history.",
      );
    }

    if (
      !payload ||
      payload.transactionsStatus !== "loaded" ||
      !Array.isArray(payload.transactions) ||
      !Number.isInteger(payload.totalCount) ||
      !Number.isInteger(payload.totalPages)
    ) {
      throw new Error("Transaction history response was incomplete.");
    }

    if (totalCount === null) {
      totalCount = payload.totalCount;
      totalPages = payload.totalPages;
    }

    if (payload.totalCount !== totalCount) {
      throw new Error(
        "Transaction history changed while loading; reload to retry.",
      );
    }

    // Same-count dataset change between pages (delete+insert, reorder)
    // duplicates one id while omitting another; the count still
    // matches, so only the duplicate betrays it. Retry from page 1.
    for (const transaction of payload.transactions) {
      const transactionId = transaction?.id;

      if (
        typeof transactionId !== "string" ||
        transactionId.length === 0
      ) {
        continue;
      }

      if (seenTransactionIds.has(transactionId)) {
        throw new Error(
          "Transaction history changed while loading; reload to retry.",
        );
      }

      seenTransactionIds.add(transactionId);
    }

    transactions.push(...payload.transactions);

    if (transactions.length > totalCount) {
      throw new Error("Transaction history response was inconsistent.");
    }

    if (payload.complete) {
      if (transactions.length !== totalCount) {
        throw new Error(
          `Transaction history is incomplete: loaded ${transactions.length} of ${totalCount} transactions.`,
        );
      }

      return Object.freeze({
        transactions: Object.freeze(transactions),
        totalCount,
      });
    }

    if (page >= totalPages) {
      throw new Error(
        "Transaction history is incomplete: the server did not finish the list.",
      );
    }

    page += 1;
  }
}
