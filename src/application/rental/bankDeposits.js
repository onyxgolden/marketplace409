// R7 domain: bank deposits — batch received payments/receipts into one bank
// deposit slip.
//
// Ledger model (the "undeposited funds" pattern): each deposited item
// references an existing financial_events INCOME row that is not yet banked
// (bank_account_id IS NULL) and not already deposited. The deposit itself
// posts exactly ONE financial_events income row for the lump total with the
// deposit's bank_account_id (normalized_category='bank_deposit',
// affects_noi=false) — the bank register and the reconciliation see one lump
// line, the shape a bank statement shows. The item events keep their P&L-side
// income untouched and never gain a bank_account_id: no duplicate income.

export const BANK_DEPOSIT_ID_PREFIX = "rental_bank_deposit_";
export const CHECK_RUN_ID_PREFIX = "rental_check_run_";
export const DEPOSIT_TENDERS = Object.freeze(["cash", "check", "money_order", "other"]);
export const DEPOSIT_STATUSES = Object.freeze(["active", "voided"]);

export function buildBankDepositId() {
  return `${BANK_DEPOSIT_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

export function buildCheckRunId() {
  return `${CHECK_RUN_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "")}`;
}

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const toPositiveInt = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const isValidDateString = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00Z`).getTime());

/** financial_events.amount is decimal dollars — round deliberately to cents. */
export function eventAmountCents(event) {
  return Math.round(Number(event?.amount || 0) * 100);
}

/**
 * Validate a deposit submission.
 * input: { id?, depositDate, bankAccountId, memo?, items: [{ eventId, tender, checkNumber?, receivedFrom?, amountCents? }] }
 * context.events: the referenced financial_events rows
 *   { id, amount, transaction_kind, bank_account_id, is_deleted, status, metadata }.
 * Returns { valid, errors, value } with totalCents.
 */
export function validateBankDepositInput(input, context = {}) {
  const errors = [];
  const eventsById = new Map();
  for (const event of context.events || []) eventsById.set(event.id, event);

  const id = isNonEmptyString(input?.id) ? input.id.trim() : buildBankDepositId();

  const depositDate = isNonEmptyString(input?.depositDate) ? input.depositDate.trim() : "";
  if (!isValidDateString(depositDate)) errors.push("Enter a valid deposit date (YYYY-MM-DD).");

  const bankAccountId = isNonEmptyString(input?.bankAccountId) ? input.bankAccountId.trim() : "";
  if (!bankAccountId) errors.push("Choose the bank account for this deposit.");

  const memo = isNonEmptyString(input?.memo) ? input.memo.trim() : "";

  const items = Array.isArray(input?.items) ? input.items : [];
  const cleanItems = [];
  if (items.length === 0) {
    errors.push("Add at least one receipt to the deposit.");
  } else {
    const seenEventIds = new Set();
    for (const item of items) {
      const eventId = isNonEmptyString(item?.eventId) ? item.eventId.trim() : "";
      const tender = isNonEmptyString(item?.tender) ? item.tender.trim() : "";
      const checkNumber = isNonEmptyString(item?.checkNumber) ? item.checkNumber.trim() : "";
      const receivedFrom = isNonEmptyString(item?.receivedFrom) ? item.receivedFrom.trim() : "";
      if (!eventId) {
        errors.push("Every deposit line needs a receipt.");
        continue;
      }
      if (seenEventIds.has(eventId)) {
        errors.push("The same receipt appears twice on this deposit.");
        continue;
      }
      seenEventIds.add(eventId);
      if (!DEPOSIT_TENDERS.includes(tender)) {
        errors.push("Every deposit line needs a tender type (cash, check, money order, or other).");
        continue;
      }
      if (tender === "check" && !checkNumber) {
        errors.push("Check lines need a check number.");
        continue;
      }
      const event = eventsById.get(eventId);
      if (!event) {
        errors.push("A receipt on this deposit was not found.");
        continue;
      }
      if (event.transaction_kind !== "income") {
        errors.push("Only received payments can be deposited.");
        continue;
      }
      if (event.is_deleted === true || event.status !== "active") {
        errors.push("Only active receipts can be deposited.");
        continue;
      }
      if (event.bank_account_id != null) {
        errors.push("A receipt already recorded against a bank account cannot be deposited again.");
        continue;
      }
      if (event.metadata?.deposit_id != null) {
        errors.push("A receipt on this deposit is already on another deposit.");
        continue;
      }
      const amountCents = eventAmountCents(event);
      if (amountCents <= 0) {
        errors.push("A deposit line must have a positive amount.");
        continue;
      }
      cleanItems.push({ eventId, tender, checkNumber, receivedFrom, amountCents });
    }
  }

  if (errors.length > 0) return { valid: false, errors, value: null };
  const totalCents = cleanItems.reduce((sum, item) => sum + item.amountCents, 0);
  return {
    valid: true,
    errors: [],
    value: { id, depositDate, bankAccountId, memo, items: cleanItems, totalCents, itemCount: cleanItems.length },
  };
}

/** Validate a deposit void. Only active deposits with a reason. */
export function validateBankDepositVoid(input, deposit) {
  const errors = [];
  if (deposit?.status !== "active") errors.push("Only active deposits can be voided.");
  const reason = isNonEmptyString(input?.reason) ? input.reason.trim() : "";
  if (!reason) errors.push("A reason is required to void a deposit.");
  if (errors.length > 0) return { valid: false, errors, value: null };
  return { valid: true, errors: [], value: { reason } };
}

export function canVoidDeposit(deposit) {
  return deposit?.status === "active";
}

/**
 * Pure reconciliation check shared by the void path.
 * A deposit whose lump event id appears on any ACTIVE reconciliation is locked.
 */
export function depositIsReconciled(depositEventId, reconciliations) {
  if (!depositEventId) return false;
  const id = String(depositEventId);
  for (const rec of reconciliations || []) {
    if (rec?.status !== "active") continue;
    const cleared = Array.isArray(rec.cleared_event_ids) ? rec.cleared_event_ids : [];
    if (cleared.some((clearedId) => String(clearedId) === id)) return true;
  }
  return false;
}

/** Serialize a deposit row for the API. options.items: deposit item rows. */
export function serializeBankDeposit(row, options = {}) {
  const items = (options.items || []).map((item) => ({
    eventId: item.financial_event_id,
    seq: Number(item.seq || 0),
    tender: item.tender,
    checkNumber: item.check_number || null,
    receivedFrom: item.received_from || null,
    amountCents: Number(item.amount_cents || 0),
  }));
  return {
    id: row.id,
    depositDate: row.deposit_date,
    bankAccountId: row.bank_account_id || null,
    memo: row.memo || "",
    totalAmountCents: Number(row.total_amount_cents || 0),
    itemCount: Number(row.item_count || 0),
    depositEventId: row.deposit_event_id || null,
    status: row.status,
    voidReason: row.void_reason || null,
    voidedAt: row.voided_at || null,
    items,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
