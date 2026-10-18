/**
 * index.js — public entry for the Finance Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic synthetic transaction
 * classification (host chart of accounts), BigInt minor-unit arithmetic
 * audit (line extension/tax, subtotals, income/expense, cash movement,
 * closing balance), anomaly register and period summary. The agent has
 * no ledger adapter, no balance mutation, no send/pay capability: it
 * returns a detached advisory JSON snapshot. Policy/chart rules come
 * from the trusted, host-injected context — never from task content.
 *
 * Budget discipline (CS-001 / DOC-002 / FM-005 bug class): every
 * candidate object — the chart source, the transaction bundle source,
 * EACH transaction inside it, and EVERY element of the injected trusted
 * context (sources, revisions, read grants, principal, criteria, chart
 * entries) — is charged with budget.countObject() as the FIRST
 * statement before any of its own fields are read. Attempt 65 refuses
 * before that candidate (or any later one) is inspected at all.
 * validateContext() requires the caller's live monotonic budget.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength, parseMinorUnits, lineExtensionMinor, lineTaxMinor, formatMinor } from "./canonical.js";
import { validateTask, validateContext, validateTransaction, splitTopLevelArray, SchemaError } from "./schemas.js";
import { resolveSourceRef, verifySpan, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { classifyAccount, cashMovement } from "./classifier.js";

export const AGENT_ID = "finance-agent";
export const SCHEMA_VERSION = "1";

const CHART_RULE_QUOTES = {
  EXACT_CODE: "Account classification uses exact code lookup against the versioned chart of accounts; no keyword-based accounting interpretation.",
  CONTRA: "Signed contra entries are allowed by explicit account schema and are never silently absolute-valued.",
  TRANSFER: "TRANSFER direction requires paired internal IDs and nets zero only when amounts and currency match.",
};

function emptyReport(scale) {
  const zero = formatMinor(0n, scale);
  return {
    period: null,
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    transaction_results: [],
    line_arithmetic: { line_count: 0, subtotal_minor: "0", subtotal_display: zero, tax_total_minor: "0", tax_total_display: zero, grand_total_minor: "0", grand_total_display: zero },
    income_expense: { income_total_minor: "0", income_display: zero, expense_total_minor: "0", expense_display: zero, net_income_minor: "0", net_display: zero, evidence_state: "unverifiable" },
    cash: { movement_minor: "0", movement_display: zero, opening_claimed_minor: "0", opening_claimed_display: zero, closing_derived_minor: "0", closing_derived_display: zero, derivation_note: "derived from claimed opening, not independently verified" },
    header_comparisons: [],
    anomalies: [],
    out_of_period_ids: [],
    excluded_ids: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    summary: null,
  };
}

function taskIdOf(task) {
  try {
    return `fin-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "fin-invalid-task";
  }
}

function envelope(task, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    status,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags,
    report: report ?? emptyReport(2),
  };
}

function refused(task, code, severity, reason, extra = {}) {
  return envelope(task, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    ...extra,
  });
}

function refKey(r) {
  return `${r.repo}|${r.path}|${r.commit}|${r.blob}`;
}

/** Resolve + verify-once a named chart rule quote. Cached per run(). */
function makeRuleCiter(chartRef, chartBytes, budget) {
  const cache = new Map();
  return function cite(ruleId) {
    if (cache.has(ruleId)) return cache.get(ruleId);
    const quoted = CHART_RULE_QUOTES[ruleId];
    const span = verifySpan(chartBytes, quoted, budget, `chart rule ${ruleId}`);
    const citation = {
      repo: chartRef.repo,
      path: chartRef.path,
      commit: chartRef.commit,
      blob: chartRef.blob,
      algorithm: "git-sha1",
      revision: chartRef.revision,
      quoted_span: span.quoted_text,
      span,
      verification: "VERIFIED",
      rule_id: ruleId,
    };
    cache.set(ruleId, citation);
    return citation;
  };
}

function inPeriod(dateStr, startDate, endDate) {
  // dateStr is YYYY-MM-DD or full instant; compare date part only.
  const d = dateStr.slice(0, 10);
  return d >= startDate.slice(0, 10) && d <= endDate.slice(0, 10);
}

export function run(task, context) {
  const clockRaw = context && typeof context === "object" ? context.clock : undefined;
  if (!Number.isFinite(clockRaw)) return refused(task, "INVALID_INPUT", "error", "context.clock must be a finite number");

  let validatedTask;
  try {
    validatedTask = validateTask(task);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  const budget = makeBudget();
  try {
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  if (validatedTask.kind === "prohibited") {
    return refused(
      task,
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read fixture-only transactions and return an advisory report); it cannot move money, initiate payments, export ledgers, or mutate any record`
    );
  }

  // validateContext charges EVERY context candidate (sources, revisions,
  // grants, principal, criteria) BEFORE any field is read. Budget is
  // required — never called without the live monotonic budget.
  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  const scale = ctx.criteria.currency_scale;

  // Authenticated request authority: Jason or his registered Muse relay.
  if (ctx.principal.revoked) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(ctx.principal.valid_from);
  const expiresAt = Date.parse(ctx.principal.expires_at);
  if (!(validFrom <= ctx.clock && ctx.clock <= expiresAt)) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // Currency: task period currency must match the host-declared currency;
  // other/mixed currencies yield UNVERIFIABLE affected totals, no FX.
  const currencyMatch = validatedTask.period.currency === ctx.criteria.currency;

  // Resolve the chart document (for citation integrity; the chart data
  // itself is host-injected via criteria, never from task content).
  if (!hasReadGrant(ctx.criteria.chart_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for chart source ${ctx.criteria.chart_ref.repo}/${ctx.criteria.chart_ref.path}`);
  }
  let chartResolved;
  try {
    chartResolved = resolveSourceRef(ctx.criteria.chart_ref, ctx.sources, budget, "chart source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `chart source: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }
  const chartInjection = scanTexts([chartResolved.text]);
  if (chartInjection.injected) {
    return refused(task, "INSTRUCTION_INJECTION", "critical", "the trusted chart source contains a seeded directive family; quarantined, no classification is possible without a trustworthy rule source", {
      quarantined_sources: [{ repo: ctx.criteria.chart_ref.repo, path: ctx.criteria.chart_ref.path, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" }],
    });
  }
  const cite = makeRuleCiter(ctx.criteria.chart_ref, chartResolved.bytes, budget);
  let exactCodeCitation, contraCitation, transferCitation;
  try {
    exactCodeCitation = cite("EXACT_CODE");
    contraCitation = cite("CONTRA");
    transferCitation = cite("TRANSFER");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `chart source: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  // Resolve the transaction bundle.
  if (!hasReadGrant(validatedTask.transaction_bundle_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for transaction bundle ${validatedTask.transaction_bundle_ref.repo}/${validatedTask.transaction_bundle_ref.path}`);
  }
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.transaction_bundle_ref, ctx.sources, budget, "transaction bundle source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `transaction bundle: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  // FIN-002: bounded-container preflight FIRST — splitTopLevelArray
  // establishes the array and the raw source span of each top-level
  // element WITHOUT decoding any candidate's fields. The charged loop
  // below then does budget.countObject() strictly BEFORE JSON.parse on
  // that candidate's span. Attempt 65 refuses before the candidate (or
  // any later one) is decoded at all.
  let spans;
  try {
    spans = splitTopLevelArray(bundleResolved.text, "transaction bundle");
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // ---- Charged pass: one countObject() per transaction, strictly before
  // that candidate's span is decoded or any of its fields read. ----
  const provisional = [];
  let budgetExceeded = false;
  for (let i = 0; i < spans.length; i++) {
    try {
      budget.countObject(`transaction[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    let raw;
    try {
      raw = JSON.parse(spans[i]);
    } catch {
      return refused(task, "INVALID_INPUT", "error", `transaction bundle entry ${i} is not valid JSON`);
    }
    let txn;
    try {
      txn = validateTransaction(raw, `transaction bundle[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) {
        // Malformed row refuses the whole payload per the brief.
        return refused(task, "INVALID_INPUT", "error", `malformed transaction at index ${i}: ${e.message}`);
      }
      throw e;
    }
    provisional.push(txn);
  }

  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining transactions`);
  }

  // ---- Unrestricted post-processing over already-charged, already-
  // validated results only: no new candidate is read here. ----
  const anomalies = [];
  const diagnostics = [];
  const quarantined_sources = [];
  const out_of_period_ids = [];
  const excluded_ids = [];
  const transaction_results = [];

  const { start_date, end_date, opening_balance_minor, currency: periodCurrency } = validatedTask.period;

  // Duplicate detection: retain both in diagnostics, refuse authoritative
  // summary. No first-wins or automatic dedup.
  const byId = new Map();
  for (const t of provisional) {
    if (!byId.has(t.transaction_id)) byId.set(t.transaction_id, []);
    byId.get(t.transaction_id).push(t);
  }
  const duplicateIds = new Set();
  for (const [id, group] of byId) {
    if (group.length > 1) {
      duplicateIds.add(id);
      for (const t of group) {
        anomalies.push({ code: "DUPLICATE_ID", severity: "error", record_id: t.transaction_id, reason: `duplicate primary transaction id '${t.transaction_id}' (${group.length} occurrences); both retained, no authoritative summary` });
        excluded_ids.push({ transaction_id: t.transaction_id, reason: "DUPLICATE_ID" });
      }
    }
  }
  const hasDuplicates = duplicateIds.size > 0;

  // Admitted = non-duplicate, validated transactions.
  const admitted = [];
  for (const [id, group] of byId) {
    if (group.length === 1) admitted.push(group[0]);
  }

  let subtotalMinor = 0n;
  let taxTotalMinor = 0n;
  let incomeTotalMinor = 0n;
  let expenseTotalMinor = 0n;
  let movementMinor = 0n;
  let lineCount = 0;
  let unknownClassCount = 0;
  let currencyMismatchCount = 0;
  const inPeriodTxns = [];
  const transferGroups = new Map();

  for (const txn of admitted) {
    const textScan = scanTexts([txn.description]);
    const quarantined = textScan.injected;
    if (quarantined) {
      quarantined_sources.push({ record_id: txn.transaction_id, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
    }

    if (!inPeriod(txn.date, start_date, end_date)) {
      anomalies.push({ code: "OUT_OF_PERIOD", severity: "info", record_id: txn.transaction_id, reason: `transaction date ${txn.date} outside period [${start_date}, ${end_date}]; listed and excluded` });
      out_of_period_ids.push(txn.transaction_id);
      excluded_ids.push({ transaction_id: txn.transaction_id, reason: "OUT_OF_PERIOD" });
      continue;
    }

    if (txn.currency !== periodCurrency || !currencyMatch) {
      currencyMismatchCount++;
      diagnostics.push({ code: "CURRENCY_UNVERIFIABLE", severity: "warning", record_id: txn.transaction_id, source_ref: null, reason: `transaction currency '${txn.currency}' vs period currency '${periodCurrency}'; affected totals UNVERIFIABLE, no FX` });
      excluded_ids.push({ transaction_id: txn.transaction_id, reason: "CURRENCY_UNVERIFIABLE" });
      continue;
    }

    const { class: acctClass, known } = classifyAccount(txn.account_code, ctx.criteria.chart);
    if (!known) {
      unknownClassCount++;
      anomalies.push({ code: "UNKNOWN_ACCOUNT", severity: "warning", record_id: txn.transaction_id, reason: `account code '${txn.account_code}' not in chart ${ctx.criteria.chart_version}; income measure unavailable for this record` });
    }

    // Line arithmetic for invoice-bearing rows.
    let extensionMinor = null;
    let taxMinor = null;
    if (txn._hasInvoice) {
      extensionMinor = lineExtensionMinor(txn.quantity, txn.unit_price_minor);
      taxMinor = lineTaxMinor(extensionMinor, txn.tax_rate);
      subtotalMinor += extensionMinor;
      taxTotalMinor += taxMinor;
      lineCount++;
    }

    // Income/expense from classification (signed amounts flow through).
    if (acctClass === "INCOME") incomeTotalMinor += txn.amount_minor;
    else if (acctClass === "EXPENSE") expenseTotalMinor += txn.amount_minor;

    // Cash movement (transfers verified separately via pairing).
    movementMinor += cashMovement(txn);
    if (txn.direction === "TRANSFER") {
      if (!transferGroups.has(txn.transfer_pair_id)) transferGroups.set(txn.transfer_pair_id, []);
      transferGroups.get(txn.transfer_pair_id).push(txn);
    }

    inPeriodTxns.push(txn);
    transaction_results.push({
      transaction_id: txn.transaction_id,
      date: txn.date,
      account_code: txn.account_code,
      classification: acctClass,
      direction: txn.direction,
      amount_minor: txn.amount_minor.toString(),
      amount_display: formatMinor(txn.amount_minor, scale),
      movement_minor: cashMovement(txn).toString(),
      extension_minor: extensionMinor === null ? null : extensionMinor.toString(),
      tax_minor: taxMinor === null ? null : taxMinor.toString(),
      quarantined,
      citations: [exactCodeCitation, contraCitation, transferCitation],
    });
  }

  // Transfer pairing: each group must net zero in the same currency.
  for (const [pairId, group] of transferGroups) {
    const net = group.reduce((acc, t) => acc + t.amount_minor, 0n);
    const currencies = new Set(group.map((t) => t.currency));
    if (group.length < 2 || net !== 0n || currencies.size !== 1) {
      for (const t of group) {
        anomalies.push({
          code: "UNPAIRED_TRANSFER",
          severity: "error",
          record_id: t.transaction_id,
          reason: `transfer group '${pairId}' does not net zero (members=${group.length}, net=${net.toString()}, currencies=${[...currencies].join(",")}); paired internal IDs required`,
        });
      }
      // Unpaired transfers are excluded from verified movement.
      for (const t of group) movementMinor -= cashMovement(t);
    }
  }

  const grandTotalMinor = subtotalMinor + taxTotalMinor;
  const netIncomeMinor = incomeTotalMinor - expenseTotalMinor;
  const closingDerivedMinor = opening_balance_minor + movementMinor;

  // Header comparisons: each claimed header compared exactly.
  const header_comparisons = [];
  let headerMismatch = false;
  let severeConflict = false;
  const hc = validatedTask.header_claims;
  function compareHeader(name, claimed, computed, display) {
    if (claimed === null) return;
    const match = claimed === computed;
    if (!match) headerMismatch = true;
    header_comparisons.push({
      metric: name,
      claimed_minor: claimed.toString(),
      claimed_display: formatMinor(claimed, scale),
      computed_minor: computed.toString(),
      computed_display: display,
      evidence_state: match ? "verified" : "mismatch",
    });
    return match;
  }

  compareHeader("subtotal_minor", hc.subtotal_minor, subtotalMinor, formatMinor(subtotalMinor, scale));
  compareHeader("tax_total_minor", hc.tax_total_minor, taxTotalMinor, formatMinor(taxTotalMinor, scale));
  compareHeader("grand_total_minor", hc.grand_total_minor, grandTotalMinor, formatMinor(grandTotalMinor, scale));
  compareHeader("income_total_minor", hc.income_total_minor, incomeTotalMinor, formatMinor(incomeTotalMinor, scale));
  compareHeader("expense_total_minor", hc.expense_total_minor, expenseTotalMinor, formatMinor(expenseTotalMinor, scale));

  const netMatch = compareHeader("net_income_minor", hc.net_income_minor, netIncomeMinor, formatMinor(netIncomeMinor, scale));
  if (netMatch === false) {
    // Opposite-sign nonzero claimed vs computed => SEVERE_INTEGRITY_CONFLICT.
    const claimed = hc.net_income_minor;
    if (claimed !== 0n && netIncomeMinor !== 0n && (claimed < 0n) !== (netIncomeMinor < 0n)) {
      severeConflict = true;
      anomalies.push({
        code: "SEVERE_INTEGRITY_CONFLICT",
        severity: "critical",
        record_id: null,
        reason: `claimed net income ${formatMinor(claimed, scale)} vs computed ${formatMinor(netIncomeMinor, scale)}: opposite-sign nonzero; PARTIAL audit-only output, summary null`,
      });
    } else {
      anomalies.push({
        code: "ARITHMETIC_MISMATCH",
        severity: "error",
        record_id: null,
        reason: `header net_income_minor claimed ${claimed.toString()} vs computed ${netIncomeMinor.toString()}; both figures preserved, no verified summary`,
      });
    }
  }

  const closingMatch = compareHeader("closing_balance_minor", hc.closing_balance_minor, closingDerivedMinor, formatMinor(closingDerivedMinor, scale));
  if (closingMatch === false) {
    anomalies.push({
      code: "BALANCE_BREAK",
      severity: "error",
      record_id: null,
      reason: `closing balance claimed ${hc.closing_balance_minor.toString()} vs derived ${closingDerivedMinor.toString()} (opening claimed ${opening_balance_minor.toString()} + verified movement ${movementMinor.toString()})`,
    });
  }

  // Subtotal/tax/grand mismatches -> ARITHMETIC_MISMATCH with both figures.
  for (const comp of header_comparisons) {
    if (comp.evidence_state === "mismatch" && ["subtotal_minor", "tax_total_minor", "grand_total_minor", "income_total_minor", "expense_total_minor"].includes(comp.metric)) {
      anomalies.push({
        code: "ARITHMETIC_MISMATCH",
        severity: "error",
        record_id: null,
        reason: `header ${comp.metric} claimed ${comp.claimed_minor} vs computed ${comp.computed_minor}; trace preserved, no verified summary`,
      });
    }
  }

  // FIN-003: unknown chart codes make the income measure unavailable;
  // incompatible currencies make income AND cash measures unavailable
  // (no FX). Computed here, right after the admitted loop finalizes the
  // classification/currency counts.
  const incomeBlocked = unknownClassCount > 0 || currencyMismatchCount > 0 || !currencyMatch;
  const cashBlocked = currencyMismatchCount > 0 || !currencyMatch;

  // Population and coverage.
  const totalPopulation = spans.length;
  const populationMatches = validatedTask.population.declared_total === totalPopulation;
  const populationVerified = validatedTask.population.complete === true && populationMatches;
  const population = {
    declared_total: validatedTask.population.declared_total,
    complete: validatedTask.population.complete,
    actual_total: totalPopulation,
    evidence_state: !validatedTask.population.complete ? "unverifiable" : populationMatches ? "verified" : "mismatch",
  };

  const admittedCount = transaction_results.length;
  const excludedCount = excluded_ids.length;

  // FIN-003: explicit unavailable-fields diagnostic with coverage
  // denominators — PARTIAL must say WHAT is unavailable and WHY, not
  // just carry a nested "partial" evidence flag.
  if (incomeBlocked || cashBlocked) {
    const unavailable = [];
    if (incomeBlocked) unavailable.push("income_expense.net_income_minor", "summary");
    if (cashBlocked) unavailable.push("cash.movement_minor", "cash.closing_derived_minor");
    diagnostics.push({
      code: "MEASURE_UNAVAILABLE",
      severity: "error",
      source_ref: null,
      record_id: null,
      reason: `affected aggregates unavailable (unknown_classifications=${unknownClassCount}, currency_mismatches=${currencyMismatchCount}, host_currency_match=${currencyMatch}); unavailable fields: ${unavailable.join(", ")}; coverage admitted=${admittedCount} excluded=${excludedCount} of declared=${totalPopulation}`,
    });
  }
  let coverageState;
  if (admittedCount === 0) coverageState = populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = populationVerified ? "COMPLETE" : "PARTIAL";

  // Income/expense evidence: unknown classifications or currency issues
  // leave the measure not fully verifiable.
  const incomeEvidence = unknownClassCount > 0 || currencyMismatchCount > 0 || !currencyMatch ? "partial" : populationVerified ? "verified" : "unverifiable";

  // Summary: refused (null) on duplicates, severe conflict, any header
  // mismatch, or — FIN-003 — unavailable income measures (incomeBlocked
  // defined above, right after the admitted loop). Recomputation remains
  // displayed as audit evidence only where the rows are fully
  // classifiable and in-currency.
  const summaryBlocked = hasDuplicates || severeConflict || headerMismatch || incomeBlocked;
  let summary = null;
  if (!summaryBlocked && populationVerified && admittedCount > 0) {
    summary = {
      period: { start_date, end_date },
      currency: periodCurrency,
      transaction_count: admittedCount,
      net_income_minor: netIncomeMinor.toString(),
      net_income_display: formatMinor(netIncomeMinor, scale),
      closing_derived_minor: closingDerivedMinor.toString(),
      closing_derived_display: formatMinor(closingDerivedMinor, scale),
      derivation_note: "closing derived from claimed opening, not independently verified",
    };
  }

  let status;
  if (admittedCount === 0) status = "EMPTY";
  else if (summaryBlocked || !populationVerified) status = "PARTIAL";
  else status = "REPORT_READY";

  const source_refs = [];
  const seenRefs = new Set();
  for (const r of [ctx.criteria.chart_ref, validatedTask.transaction_bundle_ref]) {
    const k = refKey(r);
    if (seenRefs.has(k)) continue;
    seenRefs.add(k);
    source_refs.push({ repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision });
  }

  const report = {
    period: { start_date, end_date, currency: periodCurrency, opening_claimed_minor: opening_balance_minor.toString(), opening_claimed_display: formatMinor(opening_balance_minor, scale) },
    population,
    transaction_results,
    line_arithmetic: {
      line_count: lineCount,
      subtotal_minor: subtotalMinor.toString(),
      subtotal_display: formatMinor(subtotalMinor, scale),
      tax_total_minor: taxTotalMinor.toString(),
      tax_total_display: formatMinor(taxTotalMinor, scale),
      grand_total_minor: grandTotalMinor.toString(),
      grand_total_display: formatMinor(grandTotalMinor, scale),
    },
    income_expense: {
      // FIN-003: unknown classifications or incompatible currencies make
      // the income measure unavailable — null the affected aggregates,
      // never publish a ready-looking net income over a partial set.
      income_total_minor: incomeBlocked ? null : incomeTotalMinor.toString(),
      income_display: incomeBlocked ? null : formatMinor(incomeTotalMinor, scale),
      expense_total_minor: incomeBlocked ? null : expenseTotalMinor.toString(),
      expense_display: incomeBlocked ? null : formatMinor(expenseTotalMinor, scale),
      net_income_minor: incomeBlocked ? null : netIncomeMinor.toString(),
      net_display: incomeBlocked ? null : formatMinor(netIncomeMinor, scale),
      evidence_state: incomeBlocked ? "unavailable" : incomeEvidence,
    },
    cash: {
      // FIN-003: incompatible currencies make cash movement/closing
      // unavailable (no FX). Claimed opening is an input, not an
      // affected aggregate — it stays.
      movement_minor: cashBlocked ? null : movementMinor.toString(),
      movement_display: cashBlocked ? null : formatMinor(movementMinor, scale),
      opening_claimed_minor: opening_balance_minor.toString(),
      opening_claimed_display: formatMinor(opening_balance_minor, scale),
      closing_derived_minor: cashBlocked ? null : closingDerivedMinor.toString(),
      closing_derived_display: cashBlocked ? null : formatMinor(closingDerivedMinor, scale),
      derivation_note: "derived from claimed opening, not independently verified",
    },
    header_comparisons,
    anomalies,
    out_of_period_ids,
    excluded_ids,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount },
    summary,
  };

  const result = envelope(task, {
    status,
    complete: true,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags: [],
    report,
  });

  const outputRecords =
    report.transaction_results.length +
    report.header_comparisons.length +
    report.anomalies.length +
    report.out_of_period_ids.length +
    report.excluded_ids.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.source_refs.length;
  if (outputRecords > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return refused(task, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
