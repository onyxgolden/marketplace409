// True when a Supabase/PostgREST error means the table doesn't exist
// yet (migration not applied) — the ONE shared helper for that
// question. It recognizes both shapes PostgREST reports a missing
// table in: the direct-Postgres undefined_table code (42P01, message
// "relation ... does not exist") and the PostgREST schema-cache code
// (PGRST205, message "Could not find the table ... in the schema
// cache"). Deliberately narrow: a missing COLUMN (42703, "column ...
// does not exist") is a real schema-drift bug, not a missing
// migration, and must keep reaching the ordinary 500 path — as must
// authorization (42501), syntax (42601), connectivity, and
// constraint failures. Callers: field verifications (FV-1) and bank
// reconciliation; the other per-module copies predate this helper
// and stay untouched.
export function isMissingTableError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /42P01|PGRST205|relation .* does not exist|Could not find the table/i.test(text);
}
