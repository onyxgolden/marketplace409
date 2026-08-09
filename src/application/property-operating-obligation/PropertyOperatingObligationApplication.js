import {
  createPropertyOperatingObligation,
} from "@/domains/property-operating-obligation/property-operating-obligation.types";

const MILLISECONDS_PER_DAY =
  24 * 60 * 60 * 1000;

function requireIdentifier(
  value,
  message,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(message);
  }

  return value.trim();
}

function requireDateOnly(
  value,
  fieldName,
) {
  const normalized =
    requireIdentifier(
      value,
      `${fieldName} is required.`,
    );

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalized,
    )
  ) {
    throw new Error(
      `${fieldName} must be a date in YYYY-MM-DD format.`,
    );
  }

  const timestamp =
    Date.parse(
      `${normalized}T00:00:00.000Z`,
    );

  if (Number.isNaN(timestamp)) {
    throw new Error(
      `${fieldName} must be a valid date.`,
    );
  }

  return Object.freeze({
    value: normalized,
    timestamp,
  });
}

function dayDifference(
  startTimestamp,
  endTimestamp,
) {
  return Math.round(
    (
      endTimestamp -
      startTimestamp
    ) /
      MILLISECONDS_PER_DAY,
  );
}

function allocatedAnnualAmount(
  obligation,
) {
  if (
    obligation.scope !==
      "personal_home_office"
  ) {
    return obligation
      .annualAmountCents;
  }

  return Math.round(
    obligation.annualAmountCents *
      obligation
        .businessUseBasisPoints /
      10000,
  );
}

function allocationThroughDay({
  annualAmountCents,
  elapsedDays,
  serviceDays,
}) {
  return Math.floor(
    annualAmountCents *
      elapsedDays /
      serviceDays,
  );
}

export function calculateObligationAccrual({
  obligation,
  periodStart,
  periodEnd,
}) {
  if (
    obligation
      ?.recognitionStatus !==
        "accrual_ready" ||
    obligation?.status ===
      "provisional"
  ) {
    return 0;
  }

  const serviceStart =
    requireDateOnly(
      obligation.servicePeriodStart,
      "Obligation service period start",
    );
  const serviceEnd =
    requireDateOnly(
      obligation.servicePeriodEnd,
      "Obligation service period end",
    );
  const requestedStart =
    requireDateOnly(
      periodStart,
      "Accrual period start",
    );
  const requestedEnd =
    requireDateOnly(
      periodEnd,
      "Accrual period end",
    );

  if (
    requestedEnd.timestamp <=
      requestedStart.timestamp
  ) {
    throw new Error(
      "Accrual period end must follow its start.",
    );
  }

  const overlapStart =
    Math.max(
      serviceStart.timestamp,
      requestedStart.timestamp,
    );
  const overlapEnd =
    Math.min(
      serviceEnd.timestamp,
      requestedEnd.timestamp,
    );

  if (
    overlapEnd <= overlapStart
  ) {
    return 0;
  }

  const serviceDays =
    dayDifference(
      serviceStart.timestamp,
      serviceEnd.timestamp,
    );
  const elapsedAtStart =
    dayDifference(
      serviceStart.timestamp,
      overlapStart,
    );
  const elapsedAtEnd =
    dayDifference(
      serviceStart.timestamp,
      overlapEnd,
    );
  const annualAmountCents =
    allocatedAnnualAmount(
      obligation,
    );

  return (
    allocationThroughDay({
      annualAmountCents,
      elapsedDays:
        elapsedAtEnd,
      serviceDays,
    }) -
    allocationThroughDay({
      annualAmountCents,
      elapsedDays:
        elapsedAtStart,
      serviceDays,
    })
  );
}

function expenseTreatment(
  scope,
) {
  if (scope === "property") {
    return "property_noi_expense";
  }

  if (scope === "portfolio") {
    return "portfolio_operating_expense";
  }

  return "home_office_business_expense";
}

function incrementTotal(
  totals,
  key,
  amountCents,
) {
  totals.set(
    key,
    (
      totals.get(key) || 0
    ) + amountCents,
  );
}

function frozenTotals(totals) {
  return Object.freeze(
    Object.fromEntries(
      [...totals.entries()]
        .sort(
          ([left], [right]) =>
            left.localeCompare(
              right,
            ),
        ),
    ),
  );
}

export function buildPropertyOperatingObligationAccrualProjection({
  obligations = [],
  periodStart,
  periodEnd,
} = {}) {
  const requestedStart =
    requireDateOnly(
      periodStart,
      "Accrual period start",
    );
  const requestedEnd =
    requireDateOnly(
      periodEnd,
      "Accrual period end",
    );

  if (
    requestedEnd.timestamp <=
      requestedStart.timestamp
  ) {
    throw new Error(
      "Accrual period end must follow its start.",
    );
  }

  const propertyTotals =
    new Map();
  const scopeTotals =
    new Map();
  const entries = [];
  const suppressedFinancialEventIds =
    new Set();

  for (
    const obligation of obligations
  ) {
    if (
      obligation
        ?.recognitionStatus !==
          "accrual_ready" ||
      obligation?.status ===
        "provisional"
    ) {
      continue;
    }

    if (
      obligation
        .reconciledFinancialEventId
    ) {
      suppressedFinancialEventIds.add(
        obligation
          .reconciledFinancialEventId,
      );
    }

    const amountCents =
      calculateObligationAccrual({
        obligation,
        periodStart:
          requestedStart.value,
        periodEnd:
          requestedEnd.value,
      });

    if (amountCents === 0) {
      continue;
    }

    const treatment =
      expenseTreatment(
        obligation.scope,
      );

    entries.push(
      Object.freeze({
        obligationId:
          obligation.id,
        scope:
          obligation.scope,
        propertyId:
          obligation.propertyId,
        obligationType:
          obligation.obligationType,
        subjectLabel:
          obligation.subjectLabel,
        amountCents,
        currencyCode:
          obligation.currencyCode,
        periodStart:
          requestedStart.value,
        periodEnd:
          requestedEnd.value,
        treatment,
      }),
    );

    incrementTotal(
      scopeTotals,
      obligation.scope,
      amountCents,
    );

    if (
      obligation.scope ===
        "property"
    ) {
      incrementTotal(
        propertyTotals,
        obligation.propertyId,
        amountCents,
      );
    }
  }

  entries.sort(
    (left, right) =>
      (
        left.propertyId || ""
      ).localeCompare(
        right.propertyId || "",
      ) ||
      left.obligationType.localeCompare(
        right.obligationType,
      ) ||
      left.obligationId.localeCompare(
        right.obligationId,
      ),
  );

  return Object.freeze({
    periodStart:
      requestedStart.value,
    periodEnd:
      requestedEnd.value,
    entries:
      Object.freeze(entries),
    propertyExpenseCents:
      frozenTotals(
        propertyTotals,
      ),
    scopeExpenseCents:
      frozenTotals(
        scopeTotals,
      ),
    suppressedFinancialEventIds:
      Object.freeze(
        [
          ...suppressedFinancialEventIds,
        ].sort(),
      ),
  });
}

export class PropertyOperatingObligationApplication {
  constructor({
    repository,
    clock = () =>
      new Date().toISOString(),
  } = {}) {
    if (!repository) {
      throw new Error(
        "Property operating obligation repository is required.",
      );
    }

    this.repository =
      repository;
    this.clock = clock;
  }

  async save(
    obligation,
    ownerId,
  ) {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );
    const validated =
      createPropertyOperatingObligation(
        obligation,
      );

    return this.repository.save(
      validated,
      {
        ownerId:
          requiredOwnerId,
      },
    );
  }

  async list(
    query,
    ownerId,
  ) {
    return this.repository.list(
      query || {},
      requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      ),
    );
  }

  async reconcilePayment({
    obligationId,
    financialEventId,
    ownerId,
  }) {
    const requiredOwnerId =
      requireIdentifier(
        ownerId,
        "Property operating obligation owner id is required.",
      );
    const requiredObligationId =
      requireIdentifier(
        obligationId,
        "Property operating obligation id is required.",
      );
    const requiredFinancialEventId =
      requireIdentifier(
        financialEventId,
        "Property operating obligation financial event id is required.",
      );

    const existing =
      await this.repository.findById(
        requiredObligationId,
        requiredOwnerId,
      );

    if (!existing) {
      throw new Error(
        "Property operating obligation was not found.",
      );
    }

    if (
      existing
        .reconciledFinancialEventId &&
      existing
        .reconciledFinancialEventId !==
          requiredFinancialEventId
    ) {
      throw new Error(
        "Property operating obligation is already reconciled to another financial event.",
      );
    }

    const reconciled =
      createPropertyOperatingObligation({
        ...existing,
        reconciledFinancialEventId:
          requiredFinancialEventId,
        updatedAt:
          this.clock(),
      });

    return this.repository.save(
      reconciled,
      {
        ownerId:
          requiredOwnerId,
      },
    );
  }

  async buildAccrualProjection({
    ownerId,
    periodStart,
    periodEnd,
    query = {},
  }) {
    const obligations =
      await this.list(
        query,
        ownerId,
      );

    return buildPropertyOperatingObligationAccrualProjection({
      obligations,
      periodStart,
      periodEnd,
    });
  }
}

Object.freeze(
  PropertyOperatingObligationApplication,
);
