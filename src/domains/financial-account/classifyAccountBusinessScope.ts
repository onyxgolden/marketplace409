export type AccountBusinessScope = "business" | "personal";

// Heuristic only, not an authoritative classification -- an account's name or official_name
// containing the word "business" (case-insensitive) is treated as a business account, everything
// else as personal. Mirrors the same heuristic applied to existing rows by
// 20260918020000_fix_connection_import_business_scope.sql; keep both in sync if this changes. A
// future feature should let the account's owner override this per account.
export function classifyAccountBusinessScope({
  name,
  officialName,
}: {
  name?: string | null;
  officialName?: string | null;
}): AccountBusinessScope {
  const haystack = `${name ?? ""} ${officialName ?? ""}`.toLowerCase();
  return haystack.includes("business") ? "business" : "personal";
}
