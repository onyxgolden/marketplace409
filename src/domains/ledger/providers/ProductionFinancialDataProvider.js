import { Money } from "@/platform";
import { Account } from "../accounts/Account.js";
import { AccountType } from "../accounts/AccountType.js";
import { ChartOfAccounts } from "../accounts/ChartOfAccounts.js";
import { GeneralLedger } from "../entities/GeneralLedger.js";
import { LedgerEntry } from "../entities/LedgerEntry.js";
import { LedgerDirection } from "../value-objects/LedgerDirection.js";
import { FinancialDataProvider } from "./FinancialDataProvider.js";

const UNCATEGORIZED = "uncategorized";

// financial_events rows carry the raw bank amount as signed decimal dollars (see
// correctRawBankFeedDirection.js): the sign is a direction hint from the import pipeline, not
// ledger truth. Direction here comes from transaction_kind; the entry amount is the magnitude.
function toCents(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value === 0) return null;

  return Math.round(Math.abs(value) * 100);
}

function normalizeCategory(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return text || UNCATEGORIZED;
}

function humanizeCategory(category) {
  return category
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toDateOnly(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  const text = String(value).slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

// Maps one financial_events row to a ledger account + entry. Total: never throws --
// unmappable rows are skipped (return null) so one malformed row can never take down
// reporting for the whole ledger. Only real rows become entries; nothing here invents,
// seeds, or demo-backs data.
function mapFinancialEvent(event) {
  if (!event || typeof event !== "object") return null;

  // Only live rows feed the ledger. Soft-deleted / inactive rows belong to the
  // review and reconciliation pipeline, never to reporting.
  if (event.is_deleted) return null;

  if (
    event.status !== undefined &&
    event.status !== null &&
    event.status !== "active"
  ) {
    return null;
  }

  const kind = event.transaction_kind;

  // Transfers move money between the owner's own accounts: not profit, not loss. This
  // events-sourced ledger is P&L-only (no balance-sheet accounts exist to post transfers
  // against), so transfers are excluded rather than misreported as income or expense.
  if (kind !== "income" && kind !== "expense") return null;

  const cents = toCents(event.amount);

  if (cents === null) return null;

  const category = normalizeCategory(event.normalized_category);
  const accountType =
    kind === "income" ? AccountType.REVENUE : AccountType.EXPENSE;
  // Account ids are namespaced by ledger account type ("expense:dining_drinks",
  // "revenue:rent") so an expense and an income category with the same name never
  // collide, and ask-the-books' category-family matching resolves through either the
  // account name or the id.
  const accountId = `${accountType}:${category}`;
  const direction =
    kind === "income" ? LedgerDirection.CREDIT : LedgerDirection.DEBIT;

  // The accounting date stamped into metadata is what period reporting filters on
  // (GeneralLedger.findByAccountInPeriod falls back to createdAt when it is absent).
  const journalEntryDate = toDateOnly(event.event_date);

  const account = new Account({
    id: accountId,
    name: humanizeCategory(category),
    type: accountType,
  });

  const entry = new LedgerEntry({
    id: `financial-event:${event.id ?? `${accountId}:${journalEntryDate ?? "undated"}:${cents}`}`,
    accountId,
    amount: new Money(cents),
    direction,
    description:
      typeof event.description === "string" ? event.description : "",
    metadata: {
      journalEntryDate,
      financialEventId: event.id ?? null,
      transactionKind: kind,
      normalizedCategory: category,
    },
    createdAt: event.created_at ?? event.updated_at ?? new Date(),
  });

  return { account, entry };
}

// Builds FinancialEngine inputs from real financial_events rows. Returns null when no
// usable income/expense rows exist -- the composition treats null as "financial data
// unavailable" (503), which is honest for a genuinely empty ledger and can never be
// mistaken for a $0 balance. Exported for tests.
export function buildLedgerInputsFromFinancialEvents(events) {
  const accounts = new Map();
  const entries = [];

  for (const event of events ?? []) {
    const mapped = mapFinancialEvent(event);

    if (!mapped) continue;

    if (!accounts.has(mapped.account.id)) {
      accounts.set(mapped.account.id, mapped.account);
    }

    entries.push(mapped.entry);
  }

  if (entries.length === 0) return null;

  const sortedAccounts = [...accounts.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  return {
    generalLedger: GeneralLedger.fromEntries(entries),
    chartOfAccounts: new ChartOfAccounts(sortedAccounts),
  };
}

/**
 * ProductionFinancialDataProvider
 *
 * Real-data FinancialDataProvider: feeds the owner's actual financial_events rows into
 * the reporting composition (FinancialEngine inputs). Constructed with already-fetched
 * event domain objects -- the async fetch lives with the caller (see
 * createAuthenticatedFinancialApplication.js), keeping this provider a pure, synchronous
 * mapping boundary like DemoFinancialDataProvider.
 *
 * getFinancialData() returns { generalLedger, chartOfAccounts }, or null when the owner
 * has no usable income/expense events. Null preserves the composition's deliberate
 * "unavailable, not zero" contract -- callers must 503, never report $0.
 */
export class ProductionFinancialDataProvider extends FinancialDataProvider {
  constructor({ events = [] } = {}) {
    super();

    this.events = Object.freeze([...(Array.isArray(events) ? events : [])]);

    Object.freeze(this);
  }

  getFinancialData() {
    return buildLedgerInputsFromFinancialEvents(this.events);
  }
}

Object.freeze(ProductionFinancialDataProvider);
