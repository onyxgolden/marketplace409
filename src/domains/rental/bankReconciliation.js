// Bank reconciliation — pure math for reconciling a bank account register
// against a bank statement.
//
// Input is the register built by buildBankLedger (same entries, same
// convention: income = credit, expense = debit, integer cents), the statement
// period, the statement's ending balance (as the user reads it off the
// statement), and the user's proposed cleared marks. Nothing here invents a
// figure: every number is either from the register or from the statement.
//
//   cleared balance   = Σ (credit − debit) of entries dated ≤ period end that
//                       are cleared (after the user's proposed marks)
//   book balance      = Σ (credit − debit) of every entry dated ≤ period end
//   outstanding       = entries dated ≤ period end that are NOT cleared:
//                       deposits in transit (credits) and uncleared payments
//                       (debits)
//   difference        = statement ending balance − cleared balance
//                       (0 ⇒ the statement is reconciled)
//   proof             = statement + deposits in transit − uncleared payments
//                       = book balance whenever the difference is 0
//
// Entries with no date can't be placed in a period; they are counted and
// reported, never silently included.

/** Parse a statement amount typed by the user ("$1,234.56", "-12.30", "(45.00)") into integer cents; null if unreadable. */
export function parseStatementAmountToCents(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const digits = raw.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  const cents = Math.round(Number(digits) * 100);
  return negative ? -cents : cents;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a statement period + balance. Returns an array of user-facing problems (empty when valid). */
export function validateStatement({ periodStart, periodEnd, statementEndingBalanceCents }) {
  const problems = [];
  if (!ISO_DATE.test(periodStart || "")) problems.push("Enter the statement start date.");
  if (!ISO_DATE.test(periodEnd || "")) problems.push("Enter the statement end date.");
  if (ISO_DATE.test(periodStart || "") && ISO_DATE.test(periodEnd || "") && periodStart > periodEnd) {
    problems.push("The statement start date must be on or before the end date.");
  }
  if (!Number.isSafeInteger(statementEndingBalanceCents)) problems.push("Enter the ending balance from the statement.");
  return problems;
}

/**
 * Reconcile a register against a statement.
 * @param {object} args
 * @param {Array} args.entries  buildBankLedger(...).entries
 * @param {string} args.periodStart  YYYY-MM-DD
 * @param {string} args.periodEnd    YYYY-MM-DD
 * @param {number} args.statementEndingBalanceCents
 * @param {Object<string, boolean>} [args.clearedOverrides]  { [sourceId]: proposed cleared state }
 */
export function reconcileStatement({ entries = [], periodStart, periodEnd, statementEndingBalanceCents, clearedOverrides = {} }) {
  const problems = validateStatement({ periodStart, periodEnd, statementEndingBalanceCents });
  if (problems.length > 0) return { ok: false, problems };

  const isCleared = (e) => (Object.prototype.hasOwnProperty.call(clearedOverrides, e.sourceId) ? clearedOverrides[e.sourceId] === true : e.cleared === true);
  const net = (e) => (e.creditCents || 0) - (e.debitCents || 0);

  let clearedBalanceCents = 0;
  let bookBalanceCents = 0;
  let outstandingDepositsCents = 0;
  let outstandingPaymentsCents = 0;
  let clearedDepositsInPeriodCents = 0;
  let clearedPaymentsInPeriodCents = 0;
  let undatedCount = 0;
  const outstanding = [];
  const candidates = [];
  const changes = [];

  for (const e of entries) {
    if (!e.date) {
      undatedCount += 1;
      continue;
    }
    if (e.date > periodEnd) continue;
    const cleared = isCleared(e);
    bookBalanceCents += net(e);
    const inPeriod = e.date >= periodStart;
    if (cleared) {
      clearedBalanceCents += net(e);
      if (inPeriod) {
        clearedDepositsInPeriodCents += e.creditCents || 0;
        clearedPaymentsInPeriodCents += e.debitCents || 0;
      }
    } else {
      outstanding.push(e);
      outstandingDepositsCents += e.creditCents || 0;
      outstandingPaymentsCents += e.debitCents || 0;
    }
    // What the user reconciles: everything still uncleared up to the period
    // end (it may clear on this statement), plus what's cleared in the period.
    if (!e.cleared || inPeriod || cleared !== (e.cleared === true)) {
      candidates.push({ ...e, proposedCleared: cleared });
    }
    if (cleared !== (e.cleared === true)) {
      changes.push({ sourceId: e.sourceId, from: e.cleared === true, to: cleared });
    }
  }

  const differenceCents = statementEndingBalanceCents - clearedBalanceCents;
  return {
    ok: true,
    periodStart,
    periodEnd,
    statementEndingBalanceCents,
    clearedBalanceCents,
    bookBalanceCents,
    differenceCents,
    balanced: differenceCents === 0,
    clearedDepositsInPeriodCents,
    clearedPaymentsInPeriodCents,
    outstanding,
    outstandingCount: outstanding.length,
    outstandingDepositsCents,
    outstandingPaymentsCents,
    adjustedBankBalanceCents: statementEndingBalanceCents + outstandingDepositsCents - outstandingPaymentsCents,
    candidates,
    changes,
    undatedCount,
  };
}

/**
 * Snapshot of every cleared-state change a reconciliation makes, captured
 * BEFORE the writes, so undoing it restores each item exactly (state and
 * original cleared_at).
 */
export function buildClearedSnapshot(entries, changes) {
  const byId = new Map(entries.map((e) => [e.sourceId, e]));
  return changes.map((c) => {
    const e = byId.get(c.sourceId);
    return {
      eventId: c.sourceId,
      clearedBefore: c.from,
      clearedAtBefore: e?.clearedAt ?? null,
      clearedAfter: c.to,
    };
  });
}

/**
 * Plan undoing a reconciliation: the restores to apply, or a refusal.
 * Reconciliations stack — undo the latest active one for an account first,
 * or a later statement would be left resting on changed history.
 */
export function planUndo(reconciliation, allForAccount = []) {
  if (!reconciliation || reconciliation.status !== "active") {
    return { ok: false, reason: "This reconciliation is not active." };
  }
  const later = allForAccount.find(
    (r) => r.id !== reconciliation.id && r.status === "active" && r.period_end > reconciliation.period_end,
  );
  if (later) {
    return { ok: false, reason: `Undo the later reconciliation (${later.period_start} – ${later.period_end}) first.` };
  }
  const restores = (reconciliation.cleared_snapshot || []).map((s) => ({
    eventId: s.eventId,
    cleared: s.clearedBefore === true,
    clearedAt: s.clearedBefore === true ? s.clearedAtBefore || null : null,
  }));
  return { ok: true, restores };
}
