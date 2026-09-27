// Fund-transfer domain helpers (ledger parity slice 3).
//
// A fund transfer moves money between two of the owner's bank accounts. It is
// persisted by the create_fund_transfer RPC as exactly two linked
// financial_events (expense leg out of the source, income leg into the
// destination) inside one database transaction — a one-sided transfer is
// impossible. This module holds the client-side validation and the RPC call;
// the safety checks are repeated server-side in the migration.

// ISO date (yyyy-MM-dd) with no time component; rejects impossible dates.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidIsoDate(value) {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateFundTransferInput(input) {
  const errors = [];
  const fromAccountId = String(input?.fromAccountId || "").trim();
  const toAccountId = String(input?.toAccountId || "").trim();
  const eventDate = String(input?.eventDate || "").trim();
  const amount = Number(input?.amount);

  if (!fromAccountId) errors.push("Choose the account the money leaves.");
  if (!toAccountId) errors.push("Choose the account the money goes to.");
  if (fromAccountId && toAccountId && fromAccountId === toAccountId) {
    errors.push("The source and destination accounts must be two different accounts.");
  }
  if (!isValidIsoDate(eventDate)) errors.push("Enter a valid transfer date.");
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push("The transfer amount must be greater than zero.");
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      fromAccountId,
      toAccountId,
      eventDate,
      amount: Math.round(amount * 100) / 100,
      memo: String(input?.memo || "").trim(),
      checkNumber: String(input?.checkNumber || "").trim(),
    },
  };
}

// Call the atomic create_fund_transfer RPC. Returns the parsed result
// { transferGroupId, outEventId, inEventId, ... } on success, or throws an
// Error with the database's plain-English message on failure.
export async function createFundTransfer(supabaseClient, transfer) {
  const { data, error } = await supabaseClient.rpc("create_fund_transfer", {
    p_from_account_id: transfer.fromAccountId,
    p_to_account_id: transfer.toAccountId,
    p_event: {
      amount: transfer.amount,
      eventDate: transfer.eventDate,
      memo: transfer.memo || null,
      checkNumber: transfer.checkNumber || null,
    },
  });
  if (error) throw new Error(error.message || "Unable to save the transfer.");
  const row = Array.isArray(data) ? data[0] : data;
  return {
    transferGroupId: row?.transfer_group_id || null,
    outEventId: row?.out_event_id || null,
    inEventId: row?.in_event_id || null,
    fromAccountId: row?.from_account_id || transfer.fromAccountId,
    toAccountId: row?.to_account_id || transfer.toAccountId,
    amount: row?.amount ?? transfer.amount,
    eventDate: row?.event_date || transfer.eventDate,
  };
}
