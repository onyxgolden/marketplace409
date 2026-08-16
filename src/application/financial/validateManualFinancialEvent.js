import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "./manualFinancialEventCategories";

const VALID_CATEGORIES = new Set(MANUAL_FINANCIAL_EVENT_CATEGORIES.map((item) => item.value));
const VALID_PAYMENT_METHODS = new Set(["cash", "check", "other"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateManualFinancialEvent(input) {
  const errors = [];
  const eventDate = String(input?.eventDate ?? "");
  const description = String(input?.description ?? "").trim();
  const amount = Number(input?.amount);
  const transactionKind = String(input?.transactionKind ?? "");
  const normalizedCategory = String(input?.normalizedCategory ?? "");
  const paymentMethod = String(input?.paymentMethod ?? "cash");

  if (!DATE_PATTERN.test(eventDate)) errors.push("A valid date is required.");
  if (!description) errors.push("A description is required.");
  if (!Number.isFinite(amount) || amount <= 0) errors.push("Amount must be a positive number.");
  if (!["income", "expense"].includes(transactionKind)) errors.push("Type must be income or expense.");
  if (!VALID_CATEGORIES.has(normalizedCategory)) errors.push("A valid category is required.");
  if (!VALID_PAYMENT_METHODS.has(paymentMethod)) errors.push("Payment method must be cash, check, or other.");

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
  });
}
