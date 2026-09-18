const VALID_SCOPES = new Set(["personal", "business"]);

// Shared by every budgeting API route: reads ?scope=personal|business, defaulting to "personal" so
// existing callers/links that predate the scope toggle keep working unchanged.
export function parseBudgetScope(searchParams) {
  const raw = searchParams.get("scope");
  if (raw === null) return "personal";
  return VALID_SCOPES.has(raw) ? raw : null;
}

export function isValidBudgetScope(value) {
  return VALID_SCOPES.has(value);
}
