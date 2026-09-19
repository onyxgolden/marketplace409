/**
 * formatLedgerAnswer
 *
 * Pure sentence builder for "Ask the books" answers. Takes the money formatter
 * as an argument so the domain layer stays UI-agnostic -- the financial page
 * passes its own money().
 */

import { resolveCategoryDisplayLabel } from "../../budgeting/categoryDisplayLabel.js";

export function formatLedgerAnswer(answer, formatAmount) {
  if (!answer || typeof formatAmount !== "function") {
    throw new Error("formatLedgerAnswer requires an answer and a formatAmount function");
  }

  const amount = formatAmount(answer.amount);
  const when = `in ${answer.period.label}`;
  const categoryLabel = answer.categoryFamily
    ? resolveCategoryDisplayLabel(answer.categoryFamily)
    : null;

  if (answer.metric === "revenue") {
    return categoryLabel
      ? `You earned ${amount} from ${categoryLabel} ${when}.`
      : `You earned ${amount} ${when}.`;
  }

  if (answer.metric === "net") {
    return categoryLabel
      ? `Your net on ${categoryLabel} ${when} was ${amount}.`
      : `Your net ${when} was ${amount}.`;
  }

  return categoryLabel
    ? `You spent ${amount} on ${categoryLabel} ${when}.`
    : `You spent ${amount} ${when}.`;
}
