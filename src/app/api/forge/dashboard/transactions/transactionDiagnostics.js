// FORGE load-times Slice 3 — dashboard diagnostic history helpers.
//
// Pure functions behind GET /api/forge/dashboard/transactions. The
// diagnostic endpoint serves the ENTIRE original transaction list (all
// dates, stable event_date,id order, the aggregation service's record
// shape) in pages, and the client loads every page before the history
// counts as loaded. Nothing here ever presents a partial page as a
// complete history: an incomplete load is an error, not a short list.

export const DIAGNOSTIC_PAGE_SIZE_DEFAULT = 1000;
export const DIAGNOSTIC_PAGE_SIZE_MAX = 1000;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function parseDiagnosticPageParams(searchParams) {
  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");

  const page = pageRaw === null ? 1 : Number(pageRaw);
  const pageSize =
    pageSizeRaw === null
      ? DIAGNOSTIC_PAGE_SIZE_DEFAULT
      : Number(pageSizeRaw);

  if (!Number.isInteger(page) || page < 1) {
    throw badRequest("Diagnostic page must be a positive integer.");
  }

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > DIAGNOSTIC_PAGE_SIZE_MAX
  ) {
    throw badRequest(
      `Diagnostic pageSize must be an integer between 1 and ${DIAGNOSTIC_PAGE_SIZE_MAX}.`,
    );
  }

  return { page, pageSize };
}

export function buildDiagnosticPage({ transactions, page, pageSize }) {
  if (!Array.isArray(transactions)) {
    throw new Error("Diagnostic transactions must be an array.");
  }

  const totalCount = transactions.length;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / pageSize),
  );

  if (page > totalPages) {
    throw badRequest(
      `Diagnostic page ${page} does not exist (only ${totalPages} page(s)).`,
    );
  }

  const start = (page - 1) * pageSize;

  return Object.freeze({
    success: true,
    transactions: Object.freeze(
      transactions.slice(start, start + pageSize),
    ),
    page,
    pageSize,
    totalCount,
    totalPages,
    complete: page >= totalPages,
    transactionsStatus: "loaded",
  });
}
