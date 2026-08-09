import {
  financialEventAggregationService,
} from "@/domains/financial-workspace";

import {
  buildPropertyOperatingObligationAccrualProjection,
} from "@/application/property-operating-obligation/PropertyOperatingObligationApplication.js";

const ALL_TIME_KEY =
  "all";

function validDateParts(
  eventDate,
) {
  const match =
    String(
      eventDate || "",
    ).match(
      /^(\d{4})-(\d{2})-(\d{2})/,
    );

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return {
    year,
    month,
  };
}

function monthLabel({
  year,
  month,
}) {
  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(
    new Date(
      Date.UTC(
        year,
        month - 1,
        1,
      ),
    ),
  );
}

function periodIdentity({
  year,
  month = null,
}) {
  return month
    ? `month:${year}-${String(
        month,
      ).padStart(2, "0")}`
    : `year:${year}`;
}

function toCanonicalEvent(
  transaction,
) {
  return {
    id: transaction.id,
    property_id:
      transaction.propertyId ||
      null,
    event_date:
      transaction.eventDate,
    description:
      transaction.description,
    amount:
      Number(
        transaction.amount || 0,
      ),
    transaction_kind:
      transaction.transactionKind,
    normalized_category:
      transaction.category ||
      "uncategorized",
    affects_noi:
      transaction.affectsNOI ===
      true,
    capitalized:
      transaction.capitalized ===
      true,
    source_system:
      transaction.sourceSystem ||
      "unknown",
    source_record_id:
      transaction.sourceRecordId ||
      null,
  };
}

export function buildFinancialPeriodOptions(
  transactions = [],
) {
  const periods =
    new Map();

  for (
    const transaction of transactions
  ) {
    const parts =
      validDateParts(
        transaction?.eventDate,
      );

    if (!parts) {
      continue;
    }

    const yearKey =
      periodIdentity({
        year: parts.year,
      });

    if (!periods.has(yearKey)) {
      periods.set(
        yearKey,
        Object.freeze({
          key: yearKey,
          label:
            `${parts.year} — Full year`,
          year: parts.year,
          month: null,
          mode: "year",
        }),
      );
    }

    const monthKey =
      periodIdentity(parts);

    if (!periods.has(monthKey)) {
      periods.set(
        monthKey,
        Object.freeze({
          key: monthKey,
          label:
            monthLabel(parts),
          year: parts.year,
          month: parts.month,
          mode: "month",
        }),
      );
    }
  }

  const datedOptions = [
    ...periods.values(),
  ].sort(
    (left, right) => {
      if (
        left.year !==
        right.year
      ) {
        return (
          right.year -
          left.year
        );
      }

      if (
        left.month === null
      ) {
        return -1;
      }

      if (
        right.month === null
      ) {
        return 1;
      }

      return (
        right.month -
        left.month
      );
    },
  );

  return Object.freeze([
    ...datedOptions,
    Object.freeze({
      key:
        ALL_TIME_KEY,
      label:
        "All time",
      year: null,
      month: null,
      mode: "all",
    }),
  ]);
}

export function resolveFinancialPeriodKey({
  transactions = [],
  requestedPeriodKey = null,
} = {}) {
  const options =
    buildFinancialPeriodOptions(
      transactions,
    );

  const requestedKey =
    String(
      requestedPeriodKey || "",
    ).trim();

  if (
    options.some(
      ({ key }) =>
        key === requestedKey,
    )
  ) {
    return requestedKey;
  }

  return (
    options.find(
      ({ mode }) =>
        mode === "year",
    )?.key ||
    ALL_TIME_KEY
  );
}

function dateOnly(
  year,
  month,
  day = 1,
) {
  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function nextMonth({
  year,
  month,
}) {
  return month === 12
    ? {
        year: year + 1,
        month: 1,
      }
    : {
        year,
        month: month + 1,
      };
}

function obligationPeriodBounds({
  selectedOption,
  obligations,
}) {
  if (selectedOption.mode === "year") {
    return Object.freeze({
      periodStart:
        dateOnly(
          selectedOption.year,
          1,
        ),
      periodEnd:
        dateOnly(
          selectedOption.year + 1,
          1,
        ),
    });
  }

  if (selectedOption.mode === "month") {
    const following =
      nextMonth({
        year:
          selectedOption.year,
        month:
          selectedOption.month,
      });

    return Object.freeze({
      periodStart:
        dateOnly(
          selectedOption.year,
          selectedOption.month,
        ),
      periodEnd:
        dateOnly(
          following.year,
          following.month,
        ),
    });
  }

  const recognized =
    obligations.filter(
      (obligation) =>
        obligation
          ?.recognitionStatus ===
            "accrual_ready" &&
        obligation?.status !==
          "provisional" &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(
            obligation
              ?.servicePeriodStart ||
              "",
          ),
        ) &&
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(
            obligation
              ?.servicePeriodEnd ||
              "",
          ),
        ),
    );

  if (recognized.length === 0) {
    return null;
  }

  return Object.freeze({
    periodStart:
      recognized
        .map(
          (obligation) =>
            obligation
              .servicePeriodStart,
        )
        .sort()[0],
    periodEnd:
      recognized
        .map(
          (obligation) =>
            obligation
              .servicePeriodEnd,
        )
        .sort()
        .at(-1),
  });
}

function emptyProjection() {
  return Object.freeze({
    periodStart: null,
    periodEnd: null,
    entries:
      Object.freeze([]),
    propertyExpenseCents:
      Object.freeze({}),
    scopeExpenseCents:
      Object.freeze({}),
    suppressedFinancialEventIds:
      Object.freeze([]),
  });
}

function applyObligationProjection({
  workspace,
  projection,
}) {
  const propertyExpenses =
    projection
      .propertyExpenseCents ||
    {};

  const portfolioAccrual =
    (
      Number(
        projection
          .scopeExpenseCents
          ?.property || 0,
      ) +
      Number(
        projection
          .scopeExpenseCents
          ?.portfolio || 0,
      )
    ) / 100;

  const properties =
    new Map(
      workspace.properties.map(
        (property) => [
          property.propertyId,
          {
            ...property,
            accruedOperatingExpenses:
              0,
          },
        ],
      ),
    );

  for (
    const [
      propertyId,
      amountCents,
    ] of Object.entries(
      propertyExpenses,
    )
  ) {
    const accrued =
      Number(amountCents || 0) /
      100;

    const current =
      properties.get(
        propertyId,
      ) || {
        propertyId,
        income: 0,
        expenses: 0,
        noi: 0,
        cashFlow: 0,
        transactionCount: 0,
        accruedOperatingExpenses:
          0,
      };

    properties.set(
      propertyId,
      {
        ...current,
        noi:
          Number(
            current.noi || 0,
          ) - accrued,
        accruedOperatingExpenses:
          Number(
            current
              .accruedOperatingExpenses ||
              0,
          ) + accrued,
      },
    );
  }

  return Object.freeze({
    ...workspace,
    portfolio:
      Object.freeze({
        ...workspace.portfolio,
        noi:
          Number(
            workspace.portfolio
              .noi || 0,
          ) -
          portfolioAccrual,
        accruedOperatingExpenses:
          portfolioAccrual,
      }),
    properties:
      Object.freeze(
        [...properties.values()]
          .sort(
            (left, right) =>
              left.propertyId
                .localeCompare(
                  right.propertyId,
                ),
          )
          .map(
            (property) =>
              Object.freeze(
                property,
              ),
          ),
      ),
  });
}

export function buildFinancialPeriodModel({
  transactions = [],
  obligations = [],
  requestedPeriodKey = null,
} = {}) {
  const options =
    buildFinancialPeriodOptions(
      transactions,
    );

  const selectedPeriodKey =
    resolveFinancialPeriodKey({
      transactions,
      requestedPeriodKey,
    });

  const selectedOption =
    options.find(
      ({ key }) =>
        key ===
        selectedPeriodKey,
    ) ||
    options[
      options.length - 1
    ];

  const filteredTransactions =
    selectedOption.mode === "all"
      ? [...transactions]
      : transactions.filter(
          (transaction) => {
            const parts =
              validDateParts(
                transaction
                  ?.eventDate,
              );

            if (
              !parts ||
              parts.year !==
                selectedOption.year
            ) {
              return false;
            }

            return (
              selectedOption.month ===
                null ||
              parts.month ===
                selectedOption.month
            );
          },
        );

  const bounds =
    obligationPeriodBounds({
      selectedOption,
      obligations,
    });

  const obligationProjection =
    bounds
      ? buildPropertyOperatingObligationAccrualProjection({
          obligations,
          periodStart:
            bounds.periodStart,
          periodEnd:
            bounds.periodEnd,
        })
      : emptyProjection();

  const suppressedIds =
    new Set(
      obligationProjection
        .suppressedFinancialEventIds,
    );

  const importedWorkspace =
    financialEventAggregationService
      .aggregate(
        filteredTransactions.map(
          (transaction) =>
            toCanonicalEvent({
              ...transaction,
              affectsNOI:
                suppressedIds.has(
                  transaction.id,
                )
                  ? false
                  : transaction
                      .affectsNOI,
            }),
        ),
      );

  const workspace =
    applyObligationProjection({
      workspace:
        importedWorkspace,
      projection:
        obligationProjection,
    });

  return Object.freeze({
    selectedPeriodKey,
    selectedPeriodLabel:
      selectedOption.label,
    options,
    obligationProjection,
    workspace,
  });
}

export const FinancialPeriodApplication =
  Object.freeze({
    buildOptions:
      buildFinancialPeriodOptions,
    resolveKey:
      resolveFinancialPeriodKey,
    buildModel:
      buildFinancialPeriodModel,
  });
