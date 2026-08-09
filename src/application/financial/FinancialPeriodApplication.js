import {
  financialEventAggregationService,
} from "@/domains/financial-workspace";

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

export function buildFinancialPeriodModel({
  transactions = [],
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

  const workspace =
    financialEventAggregationService
      .aggregate(
        filteredTransactions.map(
          toCanonicalEvent,
        ),
      );

  return Object.freeze({
    selectedPeriodKey,
    selectedPeriodLabel:
      selectedOption.label,
    options,
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
