import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

// The default chart of accounts. These 16 codes are also what the
// 20260927140001_chart_of_accounts migration seeds per owner. They remain the
// legacy fallback list only for workspaces whose chart table does not exist
// yet (migration not applied); they are never a fallback for a chart read
// that failed, because a failed read could hide a deliberate deactivation.
const SEED_TYPES = {
  rental_income: "income",
  cam_income: "income",
};

export const SEED_ACCOUNTS = Object.freeze(
  MANUAL_FINANCIAL_EVENT_CATEGORIES.map((entry) =>
    Object.freeze({
      code: entry.value,
      label: entry.label,
      account_type: SEED_TYPES[entry.value] || "expense",
      is_system: true,
    })
  )
);

export const SEED_CODES = new Set(SEED_ACCOUNTS.map((account) => account.code));

function toAccount(row) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    account_type: row.account_type,
    is_active: row.is_active !== false,
    is_system: row.is_system === true,
    usage_count: Number(row.usage_count || 0),
  };
}

// Idempotent: inserts any missing default codes for the owner. Safe to call
// on read -- owners with no ledger activity get their chart on first view.
export async function ensureChartSeeded(supabaseClient, ownerId) {
  const { data: existing, error: readError } = await supabaseClient
    .from("chart_of_accounts")
    .select("code")
    .eq("owner_id", ownerId);
  if (readError) throw readError;
  const have = new Set((existing || []).map((row) => row.code));
  const missing = SEED_ACCOUNTS.filter((account) => !have.has(account.code));
  if (missing.length === 0) return;
  const { error: insertError } = await supabaseClient.from("chart_of_accounts").insert(
    missing.map((account) => ({
      owner_id: ownerId,
      code: account.code,
      label: account.label,
      account_type: account.account_type,
      is_system: true,
    }))
  );
  if (insertError) throw insertError;
}

export async function getChartAccounts(supabaseClient, ownerId) {
  await ensureChartSeeded(supabaseClient, ownerId);
  const { data, error } = await supabaseClient
    .from("chart_of_accounts")
    .select("id, code, label, account_type, is_active, is_system")
    .eq("owner_id", ownerId)
    .order("account_type", { ascending: true })
    .order("label", { ascending: true });
  if (error) throw error;
  return (data || []).map(toAccount);
}

// True when the error means the chart_of_accounts table itself is missing
// (PostgREST surfaces the Postgres undefined_table code). Only this case is
// treated as legacy mode -- any other read error must fail closed so a
// transient failure can never post to a deliberately deactivated account.
export function isChartTableMissing(error) {
  if (!error) return false;
  const code = String(error.code || "").toUpperCase();
  const message = String(error.message || "");
  return code === "42P01" || /relation\s+"?chart_of_accounts"?\s+does not exist/i.test(message);
}

export class ChartUnavailableError extends Error {
  constructor(cause) {
    super("The chart of accounts could not be read. No transaction was recorded.");
    this.name = "ChartUnavailableError";
    this.cause = cause;
  }
}

// The category codes a new posting may use:
// - chart reads fine -> the owner's active codes (authoritative);
// - chart table missing entirely (migration not yet applied) -> null, so the
//   validator uses the long-standing built-in list (legacy mode);
// - any other read error -> throws ChartUnavailableError so callers can fail
//   closed (503) instead of silently accepting a deactivated account.
export async function resolvePostingCategories(supabaseClient, ownerId) {
  try {
    return [...(await getActiveAccountCodes(supabaseClient, ownerId))];
  } catch (error) {
    if (isChartTableMissing(error)) return null;
    throw new ChartUnavailableError(error);
  }
}

// Active codes the transaction validator should accept for this owner:
// the long-standing defaults plus any custom accounts they added.
export async function getActiveAccountCodes(supabaseClient, ownerId) {
  const accounts = await getChartAccounts(supabaseClient, ownerId);
  return new Set(accounts.filter((account) => account.is_active).map((account) => account.code));
}

// How many ledger rows post to this code (events + split lines). Used for
// the usage count and the deactivation guard.
export async function getAccountUsageCount(supabaseClient, ownerId, code) {
  const { count: eventCount, error: eventError } = await supabaseClient
    .from("financial_events")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("normalized_category", code);
  if (eventError) throw eventError;
  const { count: splitCount, error: splitError } = await supabaseClient
    .from("financial_event_splits")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("normalized_category", code);
  if (splitError) throw splitError;
  return (eventCount || 0) + (splitCount || 0);
}
