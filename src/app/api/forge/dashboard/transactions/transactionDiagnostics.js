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

export function buildDiagnosticPage({ pageResult, page, pageSize }) {
  // Fix round (diagnostic endpoint): the page result now comes from the
  // server-side paginated RPC, not from a full in-memory list -- the
  // route used to rebuild the owner's entire history per page request.
  // The response shape and the paging semantics are unchanged: the same
  // totalCount/totalPages/complete contract the client loads every page
  // against, and a page past the end is still a 400, never a silent
  // empty page.
  if (
    !pageResult ||
    typeof pageResult !== "object" ||
    !Array.isArray(pageResult.transactions) ||
    !Number.isInteger(pageResult.totalCount) ||
    !Number.isInteger(pageResult.totalPages) ||
    typeof pageResult.complete !== "boolean"
  ) {
    throw new Error("Diagnostic transactions must be a page result.");
  }

  const { totalCount, totalPages, complete } = pageResult;

  if (page > totalPages) {
    throw badRequest(
      `Diagnostic page ${page} does not exist (only ${totalPages} page(s)).`,
    );
  }

  return Object.freeze({
    success: true,
    transactions: Object.freeze(pageResult.transactions),
    page,
    pageSize,
    totalCount,
    totalPages,
    complete: page >= totalPages ? true : complete,
    transactionsStatus: "loaded",
  });
}
