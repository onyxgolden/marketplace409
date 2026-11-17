// FORGE load-times Slice 3 — dashboard diagnostic history loader.
//
// Pure fetch loop behind the "Read Model Diagnostic Layer" in
// ForgeDashboardClient. Loads EVERY page of
// /api/forge/dashboard/transactions before the history counts as loaded.
// A server that claims completeness while rows are still missing, a
// totalCount that changes mid-load, or a page stream that never ends is
// an error -- never a partial history presented as complete.

export async function loadAllDiagnosticTransactions({
  fetcher = fetch,
  pageSize = 1000,
} = {}) {
  const transactions = [];
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
