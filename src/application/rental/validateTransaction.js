import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const VALID_CATEGORIES = new Set(MANUAL_FINANCIAL_EVENT_CATEGORIES.map((item) => item.value));
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

const text = (value) => String(value ?? "").trim();

// Shared validation for the Rentec-style transaction form (create + edit).
// Mirrors validateManualFinancialEvent but covers the full ledger field set:
// payee, check number, bank account, tenant, cleared flag, and charge-tenant.
export function validateTransaction(input) {
  const errors = [];
  const eventDate = text(input?.eventDate);
  const description = text(input?.description);
  const amount = Number(input?.amount);
  const transactionKind = text(input?.transactionKind);
  const normalizedCategory = text(input?.normalizedCategory);
  const payee = text(input?.payee);
  const checkNumber = text(input?.checkNumber);
  const bankAccountId = text(input?.bankAccountId);
  const propertyId = text(input?.propertyId);
  const tenantId = text(input?.tenantId);
  const memo = text(input?.memo);
  const cleared = input?.cleared;
  const chargeTenant = input?.chargeTenant;

  if (!DATE_PATTERN.test(eventDate)) errors.push("A valid date is required.");
  if (!description) errors.push("A description is required.");
  if (description.length > MAX_TEXT) errors.push("Description must be 500 characters or fewer.");
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Amount must be a positive number.");
  if (!["income", "expense"].includes(transactionKind)) errors.push("Type must be income or expense.");
  if (!VALID_CATEGORIES.has(normalizedCategory)) errors.push("A valid category is required.");
  if (payee.length > MAX_TEXT) errors.push("Payee must be 500 characters or fewer.");
  if (checkNumber.length > 100) errors.push("Check number must be 100 characters or fewer.");
  if (memo.length > 2000) errors.push("Memo must be 2000 characters or fewer.");
  if (cleared !== undefined && typeof cleared !== "boolean") errors.push("Cleared must be true or false.");
  if (chargeTenant !== undefined && typeof chargeTenant !== "boolean") errors.push("Charge tenant must be true or false.");
  if (chargeTenant === true && !tenantId) errors.push("Select a tenant to charge.");

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    // Normalized payload the route can write directly.
    value: Object.freeze({
      eventDate,
      description,
      amount: Math.abs(amount),
      transactionKind,
      normalizedCategory,
      payee: payee || null,
      checkNumber: checkNumber || null,
      bankAccountId: bankAccountId || null,
      propertyId: propertyId || null,
      tenantId: tenantId || null,
      memo: memo || null,
      cleared: cleared === true,
      chargeTenant: chargeTenant === true,
    }),
  });
}
