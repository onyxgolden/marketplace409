import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const VALID_CATEGORIES = new Set(MANUAL_FINANCIAL_EVENT_CATEGORIES.map((item) => item.value));

// Split lines for a transaction. The total must equal the transaction total to
// the cent — a split that is a penny short or over leaves the ledger
// unbalanced, so anything but exact is rejected.
export function validateSplits(splits, transactionAmount) {
  const errors = [];
  if (!Array.isArray(splits) || splits.length === 0) {
    return { valid: false, errors: ["At least one split line is required."], value: null };
  }
  if (splits.length > 50) {
    return { valid: false, errors: ["A transaction can have at most 50 split lines."], value: null };
  }

  const transactionCents = Math.round(Number(transactionAmount) * 100);
  if (!Number.isFinite(transactionCents) || transactionCents <= 0) {
    return { valid: false, errors: ["The transaction total must be a positive amount."], value: null };
  }

  const normalized = splits.map((split, index) => {
    const line = index + 1;
    const category = String(split?.normalizedCategory || "").trim();
    const amount = Number(split?.amount);
    const memo = String(split?.memo || "").trim().slice(0, 500);
    if (!VALID_CATEGORIES.has(category)) errors.push(`Split line ${line}: a valid category is required.`);
    if (!Number.isFinite(amount) || Math.round(amount * 100) <= 0) errors.push(`Split line ${line}: enter a positive amount.`);
    return { normalizedCategory: category, amount, memo: memo || null };
  });

  const splitCents = normalized.reduce((sum, split) => sum + Math.round(Number(split.amount) * 100), 0);
  if (splitCents !== transactionCents) {
    const difference = ((splitCents - transactionCents) / 100).toFixed(2);
    errors.push(
      `Split lines total $${(splitCents / 100).toFixed(2)} but the transaction is $${(transactionCents / 100).toFixed(2)} — off by $${difference}. Adjust the lines so they match exactly.`,
    );
  }

  if (errors.length > 0) return { valid: false, errors, value: null };
  return { valid: true, errors: [], value: { splits: normalized } };
}
