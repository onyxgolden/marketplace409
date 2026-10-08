// FORGE Work Management — package planned-vs-actual cost read model.
//
// Pure and deterministic: the application service supplies owner-scoped rows,
// and this module decides which uniquely linked financial events may count.
// Actuals are financial-event based only. Contractor payments are never added
// independently; they only suppress an explicitly referenced financial event
// when the payment is owner-scoped, property-compatible, and for exactly the
// same cents (the property-ledger duplicate rule).

import { canonicalPropertySlug } from "@/domains/property/propertyAliases.js";
import {
  FINANCIAL_EVENT_SAFE_SOURCES,
  FINANCIAL_EVENT_EXCLUDED_STATUSES,
  contractorPaymentIdOf,
  parseDecimalAmountToCents,
} from "@/domains/rental/financialEventRules.js";

export { parseDecimalAmountToCents };

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

function decimalTextToCents(text) {
  const cleaned = String(text).trim().replace(/^\$/, "").replace(/,/g, "");
  return parseDecimalAmountToCents(cleaned);
}

/**
 * Parse a user-entered planned-budget dollar amount to exact integer cents.
 * Empty input clears the budget (null), which is distinct from an explicit
 * zero budget. Negative amounts, extra decimal places, and overflow fail.
 */
export function parsePlannedBudgetToCents(value) {
  if (value === null || value === undefined) return { ok: true, cents: null };
  if (typeof value === "string" && value.trim() === "") return { ok: true, cents: null };
  if (typeof value === "number" || typeof value === "string") {
    const parsed = decimalTextToCents(value);
    if (!parsed.ok) return parsed;
    if (parsed.cents < 0) return { ok: false, error: "planned budget cannot be negative." };
    return { ok: true, cents: parsed.cents };
  }
  return { ok: false, error: "planned budget must be a decimal dollar amount." };
}

/** Validate a planned-cost value already expressed in integer cents. */
export function normalizePlannedCostCents(value) {
  if (value === null || value === undefined) return { ok: true, cents: null };
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_SAFE_CENTS) {
      return { ok: false, error: "planned_cost_cents must be a nonnegative safe integer." };
    }
    return { ok: true, cents: Number(value) };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return { ok: false, error: "planned_cost_cents must be a nonnegative safe integer." };
    }
    return { ok: true, cents: value };
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const cents = BigInt(value.trim());
    if (cents > MAX_SAFE_CENTS) {
      return { ok: false, error: "planned_cost_cents must be a nonnegative safe integer." };
    }
    return { ok: true, cents: Number(cents) };
  }
  return { ok: false, error: "planned_cost_cents must be a nonnegative safe integer." };
}

export function formatCents(cents) {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder}`;
}

function isCostOrientation(link) {
  return link?.source_domain === "financial"
    && link?.source_type === "financial_event"
    && link?.target_domain === "workmgmt"
    && link?.target_type === "work_package";
}

function isEligibleLink(link, ownerId) {
  return Boolean(link)
    && (!ownerId || !link.owner_id || link.owner_id === ownerId)
    && link.relationship_type === "cost_attributed"
    && isCostOrientation(link)
    && link.status === "active"
    && link.provenance === "user_confirmed";
}

function exclusion(code, eventId, message, amountCents = null) {
  return { code, eventId, message, amountCents };
}

function propertyMatches(reference, packagePropertyId, unitIds) {
  if (!reference) return false;
  if (unitIds.has(reference)) return true;
  if (!packagePropertyId) return false;
  return canonicalPropertySlug(reference) === canonicalPropertySlug(packagePropertyId);
}

export function buildPackageCostSummary({
  package: pkg,
  ownerId = null,
  links = [],
  events = [],
  contractorPayments = [],
  unitIds = [],
} = {}) {
  const packageId = pkg?.id || null;
  const plannedParsed = normalizePlannedCostCents(pkg?.planned_cost_cents);
  const plannedCostCents = plannedParsed.ok ? plannedParsed.cents : null;
  const unitIdSet = new Set((unitIds || []).filter(Boolean).map(String));

  const eventsById = new Map();
  for (const event of events || []) {
    if (!event?.id) continue;
    if (ownerId && event.owner_id && event.owner_id !== ownerId) continue;
    if (!eventsById.has(event.id)) eventsById.set(event.id, event);
  }

  const contractorPaymentsById = new Map();
  for (const payment of contractorPayments || []) {
    if (!payment?.id) continue;
    if (ownerId && payment.owner_id && payment.owner_id !== ownerId) continue;
    if (!contractorPaymentsById.has(payment.id)) contractorPaymentsById.set(payment.id, payment);
  }

  // Full-event attribution only: an eligible event actively attributed to
  // more than one package is ambiguous everywhere, never split or doubled.
  const eligiblePackagesByEvent = new Map();
  for (const link of links || []) {
    if (!isEligibleLink(link, ownerId)) continue;
    const packages = eligiblePackagesByEvent.get(link.source_id) || new Set();
    packages.add(link.target_id);
    eligiblePackagesByEvent.set(link.source_id, packages);
  }

  const packageLinks = (links || []).filter((link) => (
    link?.relationship_type === "cost_attributed"
    && (link.target_id === packageId || link.source_id === packageId)
  ));

  const linksByEvent = new Map();
  for (const link of packageLinks) {
    const eventId = isCostOrientation(link) ? link.source_id : link.target_id;
    if (!eventId) continue;
    const group = linksByEvent.get(eventId) || [];
    group.push(link);
    linksByEvent.set(eventId, group);
  }

  const includedEvents = [];
  const excludedEvents = [];
  const ambiguousEventIds = [];
  const warnings = [];
  const includedLinkIds = [];
  let duplicateLinkCount = 0;
  let suppressedContractorEventCount = 0;
  let suppressedContractorAmountCents = 0;
  let actualCentsTotal = 0n;

  const addWarning = (code, message, eventId = null) => {
    if (!warnings.some((warning) => warning.code === code && warning.eventId === eventId)) {
      warnings.push({ code, message, eventId });
    }
  };

  if (!plannedParsed.ok) {
    addWarning("invalid_planned_cost", "The stored planned budget is invalid and is treated as not budgeted.");
  }
  if (!pkg?.property_id && linksByEvent.size > 0) {
    addWarning(
      "unassigned_package_scope",
      "Package has no assigned property; only linked events without a property association are included.",
    );
  }

  for (const [eventId, eventLinks] of [...linksByEvent.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    const eligibleLinks = eventLinks.filter((link) => isEligibleLink(link, ownerId));
    if (eligibleLinks.length === 0) {
      const foreign = eventLinks.some((link) => ownerId && link.owner_id && link.owner_id !== ownerId);
      const invalidOrientation = eventLinks.some((link) => !isCostOrientation(link));
      const inactive = eventLinks.find((link) => link.status !== "active");
      const unconfirmed = eventLinks.find((link) => link.provenance !== "user_confirmed");
      const item = foreign
        ? exclusion("foreign_owner_link", eventId, "A linked financial event belongs to another workspace and was excluded.")
        : invalidOrientation
          ? exclusion("invalid_link_orientation", eventId, "A cost link has the wrong orientation and was excluded.")
          : inactive
            ? exclusion("inactive_link", eventId, `A cost link is ${inactive.status || "inactive"} and was excluded.`)
            : exclusion("unconfirmed_link", eventId, "A cost link has not been confirmed by a person and was excluded.");
      if (!foreign && !invalidOrientation && !inactive && unconfirmed) {
        item.code = "unconfirmed_link";
      }
      excludedEvents.push(item);
      addWarning(item.code, item.message, eventId);
      continue;
    }

    duplicateLinkCount += eligibleLinks.length - 1;
    const attributedPackages = eligiblePackagesByEvent.get(eventId) || new Set();
    if (attributedPackages.size > 1) {
      ambiguousEventIds.push(eventId);
      addWarning(
        "ambiguous_multiple_packages",
        "This financial event is linked to multiple packages, so it is excluded from package actuals until the attribution is resolved.",
        eventId,
      );
      continue;
    }

    const event = eventsById.get(eventId);
    if (!event) {
      const item = exclusion("event_not_found", eventId, "A linked financial event could not be found in this workspace and was excluded.");
      excludedEvents.push(item);
      addWarning(item.code, item.message, eventId);
      continue;
    }

    let item = null;
    if (event.is_deleted === true) {
      item = exclusion("deleted_event", eventId, "A linked financial event is deleted and was excluded.");
    } else if (FINANCIAL_EVENT_EXCLUDED_STATUSES.has(event.status)) {
      item = exclusion("inactive_event", eventId, "A linked financial event is inactive or deleted and was excluded.");
    } else if (!FINANCIAL_EVENT_SAFE_SOURCES.has(event.source_system)) {
      item = exclusion("unsupported_source", eventId, "A linked financial event uses an unsupported source and was excluded.");
    } else if (event.transaction_kind === "income") {
      item = exclusion("income_not_expense", eventId, "A linked financial event is income, not an expense, and was excluded.");
    } else if (event.transaction_kind !== "expense") {
      item = exclusion("unsupported_transaction_kind", eventId, "A linked financial event is not an expense and was excluded.");
    }

    const amount = item ? null : parseDecimalAmountToCents(event.amount);
    if (!item && !amount.ok) {
      item = exclusion("invalid_amount", eventId, "A linked financial event has an invalid or overflowing amount and was excluded.");
    }
    if (item) {
      excludedEvents.push(item);
      addWarning(item.code, item.message, eventId);
      continue;
    }

    const amountCents = Math.abs(amount.cents);
    if (pkg?.property_id) {
      // Assigned package: fail closed. The event must carry a POSITIVE
      // matching association — canonical property slug or exact known unit
      // id. A property-less event (null/blank event property_id) can never
      // prove it belongs to this property, so it is excluded rather than
      // silently assigning unallocated portfolio spending to this property.
      const eventProperty = typeof event.property_id === "string"
        ? event.property_id.trim()
        : event.property_id;
      if (!eventProperty) {
        item = exclusion(
          "property_unassigned_event",
          eventId,
          "A linked financial event has no property association, so it was excluded from this property's package actuals.",
          amountCents,
        );
      } else if (!propertyMatches(eventProperty, pkg.property_id, unitIdSet)) {
        item = exclusion("property_mismatch", eventId, "A linked financial event belongs to a different property and was excluded.", amountCents);
      }
    } else if (event.property_id) {
      item = exclusion(
        "unassigned_property_conflict",
        eventId,
        "A linked financial event has a property association, but this package is unassigned, so it was excluded.",
        amountCents,
      );
    }
    if (item) {
      excludedEvents.push(item);
      addWarning(item.code, item.message, eventId);
      continue;
    }

    const contractorPaymentId = contractorPaymentIdOf(event);
    if (contractorPaymentId) {
      const payment = contractorPaymentsById.get(contractorPaymentId);
      if (!payment) {
        addWarning(
          "contractor_payment_unverified",
          "A linked financial event references a contractor payment that could not be verified in this workspace; the event was included.",
          eventId,
        );
      } else if (pkg?.property_id
        ? !propertyMatches(payment.property_id, pkg.property_id, unitIdSet)
        : Boolean(payment.property_id)) {
        addWarning(
          "contractor_payment_property_mismatch",
          "A linked contractor payment belongs to a different property, so the financial event was included.",
          eventId,
        );
      } else {
        const paymentAmount = normalizePlannedCostCents(payment.amount_cents);
        if (!paymentAmount.ok || paymentAmount.cents === null) {
          addWarning(
            "contractor_payment_amount_invalid",
            "A linked contractor payment has an invalid amount, so the financial event was included.",
            eventId,
          );
        } else if (paymentAmount.cents !== amountCents) {
          addWarning(
            "contractor_payment_amount_mismatch",
            "A linked contractor payment amount does not match the financial event, so the event was included.",
            eventId,
          );
        } else {
          const suppressed = exclusion(
            "contractor_payment_recorded_separately",
            eventId,
            "Contractor payout recorded separately; not included in package actuals",
            amountCents,
          );
          excludedEvents.push(suppressed);
          addWarning(suppressed.code, suppressed.message, eventId);
          suppressedContractorEventCount += 1;
          suppressedContractorAmountCents += amountCents;
          continue;
        }
      }
    }

    actualCentsTotal += BigInt(amountCents);
    includedLinkIds.push(...eligibleLinks.map((link) => link.id).filter(Boolean));
    includedEvents.push({
      eventId,
      linkIds: eligibleLinks.map((link) => link.id).filter(Boolean),
      amountCents,
      eventDate: event.event_date || null,
      description: event.description || null,
    });
  }

  includedEvents.sort((a, b) => String(a.eventDate || "").localeCompare(String(b.eventDate || ""))
    || String(a.eventId).localeCompare(String(b.eventId)));
  excludedEvents.sort((a, b) => String(a.eventId).localeCompare(String(b.eventId)));
  ambiguousEventIds.sort();

  // Fail closed on aggregate precision: individual amounts are safe-integer
  // validated, but their BigInt sum (or the planned-vs-actual difference) can
  // exceed the exact JS integer range. Never hand callers an imprecise
  // Number — report the totals as unavailable with an explicit error state.
  let actualCostCents = null;
  let varianceCents = null;
  let totalsError = null;
  if (actualCentsTotal > MAX_SAFE_CENTS) {
    totalsError = {
      code: "actual_total_overflow",
      message: "The linked spending total is too large to count exactly, so package totals are unavailable instead of approximated.",
    };
  } else {
    actualCostCents = Number(actualCentsTotal);
    if (plannedCostCents !== null) {
      const variance = actualCentsTotal - BigInt(plannedCostCents);
      if (variance > MAX_SAFE_CENTS || variance < -MAX_SAFE_CENTS) {
        totalsError = {
          code: "variance_total_overflow",
          message: "The planned-versus-recorded difference is too large to count exactly, so package totals are unavailable instead of approximated.",
        };
        actualCostCents = null;
      } else {
        varianceCents = Number(variance);
      }
    }
  }
  if (totalsError) addWarning(totalsError.code, totalsError.message);

  return Object.freeze({
    packageId,
    packagePropertyId: pkg?.property_id || null,
    scope: pkg?.property_id ? "assigned_property" : "unassigned",
    plannedCostCents,
    actualCostCents,
    varianceCents,
    totalsError: totalsError ? Object.freeze(totalsError) : null,
    hasPlan: plannedCostCents !== null,
    includedEventCount: includedEvents.length,
    includedEventIds: includedEvents.map((event) => event.eventId),
    includedEvents: Object.freeze(includedEvents.map((event) => Object.freeze(event))),
    linkedEventCount: linksByEvent.size,
    excludedEventCount: excludedEvents.length,
    excludedEvents: Object.freeze(excludedEvents.map((event) => Object.freeze(event))),
    ambiguousEventCount: ambiguousEventIds.length,
    ambiguousEventIds: Object.freeze(ambiguousEventIds),
    duplicateLinkCount,
    suppressedContractorEventCount,
    suppressedContractorAmountCents,
    warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
    provenance: Object.freeze({
      source: "user_confirmed_cost_attributed_links",
      orientation: "financial:financial_event -> workmgmt:work_package",
      ownerId,
      packageId,
      linkIds: Object.freeze([...new Set(includedLinkIds)]),
      eventIds: Object.freeze(includedEvents.map((event) => event.eventId)),
    }),
  });
}
