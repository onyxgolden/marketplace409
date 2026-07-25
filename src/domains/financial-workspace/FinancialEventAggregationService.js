const UNASSIGNED_PROPERTY_ID = "unassigned";

function freezeCollection(items) {
  return Object.freeze(
    items.map((item) =>
      Object.freeze({
        ...item,
      }),
    ),
  );
}

function toAmount(event) {
  const amount = Number(event.amount);

  if (!Number.isFinite(amount)) {
    throw new Error("Financial event amount must be a finite number");
  }

  return Math.abs(amount);
}

function isActiveEvent(event) {
  return (
    event &&
    typeof event === "object" &&
    event.status !== "inactive" &&
    event.status !== "deleted" &&
    event.is_deleted !== true
  );
}

function createTotals() {
  return {
    income: 0,
    expenses: 0,
    noi: 0,
    cashFlow: 0,
    transactionCount: 0,
  };
}

function applyEventToTotals(totals, event) {
  const amount = toAmount(event);

  switch (event.transaction_kind) {
    case "income":
      totals.income += amount;
      totals.cashFlow += amount;

      if (event.affects_noi === true) {
        totals.noi += amount;
      }

      break;

    case "expense":
      totals.expenses += amount;
      totals.cashFlow -= amount;

      if (event.affects_noi === true) {
        totals.noi -= amount;
      }

      break;

    case "asset_purchase":
      // Capital acquisition.
      // Count as activity but do not classify as operating
      // revenue, operating expense, or NOI.
      break;

    default:
      throw new Error(
        `Unsupported financial event transaction kind: ${event.transaction_kind}`,
      );
  }

  totals.transactionCount += 1;
}

function freezeTotals(totals) {
  return Object.freeze({
    income: totals.income,
    expenses: totals.expenses,
    noi: totals.noi,
    cashFlow: totals.cashFlow,
    transactionCount: totals.transactionCount,
  });
}

/**
 * FinancialEventAggregationService
 *
 * Pure domain service for deterministic aggregation of canonical
 * FinancialEvent collections.
 *
 * This service does not access repositories, databases, applications,
 * routes, or presentation components.
 */
export class FinancialEventAggregationService {
  aggregate(events) {
    if (!Array.isArray(events)) {
      throw new Error("Financial events must be an array");
    }

    const activeEvents = events.filter(isActiveEvent);
    const portfolioTotals = createTotals();
    const propertyTotals = new Map();
    const categoryTotals = new Map();

    for (const event of activeEvents) {
      applyEventToTotals(portfolioTotals, event);

      const propertyId =
        event.property_id || UNASSIGNED_PROPERTY_ID;

      if (!propertyTotals.has(propertyId)) {
        propertyTotals.set(propertyId, createTotals());
      }

      applyEventToTotals(propertyTotals.get(propertyId), event);

      const category =
        event.normalized_category || "uncategorized";

      if (!categoryTotals.has(category)) {
        categoryTotals.set(category, {
          category,
          income: 0,
          expenses: 0,
          netAmount: 0,
          transactionCount: 0,
        });
      }

      const categorySummary = categoryTotals.get(category);
      const amount = toAmount(event);

      if (event.transaction_kind === "income") {
        categorySummary.income += amount;
        categorySummary.netAmount += amount;
      } else if (event.transaction_kind === "expense") {
        categorySummary.expenses += amount;
        categorySummary.netAmount -= amount;
      } else if (event.transaction_kind === "asset_purchase") {
        // Preserve category visibility without affecting
        // operating totals.
      } else {
        throw new Error(
          `Unsupported financial event transaction kind: ${event.transaction_kind}`,
        );
      }

      categorySummary.transactionCount += 1;
    }

    const properties = freezeCollection(
      [...propertyTotals.entries()]
        .map(([propertyId, totals]) => ({
          propertyId,
          ...freezeTotals(totals),
        }))
        .sort((left, right) =>
          left.propertyId.localeCompare(right.propertyId),
        ),
    );

    const categories = freezeCollection(
      [...categoryTotals.values()].sort((left, right) =>
        left.category.localeCompare(right.category),
      ),
    );

    const transactions = freezeCollection(
      [...activeEvents]
        .sort((left, right) => {
          const dateComparison = String(left.event_date).localeCompare(
            String(right.event_date),
          );

          if (dateComparison !== 0) {
            return dateComparison;
          }

          return String(left.id || "").localeCompare(
            String(right.id || ""),
          );
        })
        .map((event) => ({
          id: event.id,
          propertyId:
            event.property_id || UNASSIGNED_PROPERTY_ID,
          eventDate: event.event_date,
          description: event.description,
          amount: toAmount(event),
          transactionKind: event.transaction_kind,
          category:
            event.normalized_category || "uncategorized",
          affectsNOI: event.affects_noi === true,
          capitalized: event.capitalized === true,
          sourceSystem: event.source_system,
          sourceRecordId: event.source_record_id ?? null,
        })),
    );

    return Object.freeze({
      portfolio: freezeTotals(portfolioTotals),
      properties,
      categories,
      transactions,
    });
  }
}

export const financialEventAggregationService =
  new FinancialEventAggregationService();

export const FinancialWorkspacePropertyIds = Object.freeze({
  UNASSIGNED: UNASSIGNED_PROPERTY_ID,
});

Object.freeze(FinancialEventAggregationService);
