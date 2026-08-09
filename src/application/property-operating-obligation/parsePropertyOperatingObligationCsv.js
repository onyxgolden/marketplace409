import {
  createPropertyOperatingObligation,
} from "@/domains/property-operating-obligation/property-operating-obligation.types";

function normalizeHeader(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCells(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (
    let index = 0;
    index < csv.length;
    index += 1
  ) {
    const character = csv[index];

    if (quoted) {
      if (character === '"') {
        if (
          csv[index + 1] === '"'
        ) {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (
      character === "\n" ||
      character === "\r"
    ) {
      if (
        character === "\r" &&
        csv[index + 1] === "\n"
      ) {
        index += 1;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += character;
  }

  if (quoted) {
    throw new Error(
      "Property operating obligation CSV contains an unterminated quoted field.",
    );
  }

  if (
    value !== "" ||
    row.length > 0
  ) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter(
    (cells) =>
      cells.some(
        (cell) =>
          String(cell).trim() !== "",
      ),
  );
}

export function parsePropertyOperatingObligationCsv(
  csv,
) {
  if (
    typeof csv !== "string" ||
    csv.trim() === ""
  ) {
    throw new Error(
      "Property operating obligation CSV is required.",
    );
  }

  const parsedRows =
    parseCells(csv);

  if (parsedRows.length < 2) {
    throw new Error(
      "Property operating obligation CSV must contain a header and data rows.",
    );
  }

  const headers =
    parsedRows[0].map(
      normalizeHeader,
    );

  const requiredHeaders = [
    "date",
    "property",
    "description",
    "expense",
  ];

  const missingHeaders =
    requiredHeaders.filter(
      (header) =>
        !headers.includes(header),
    );

  if (missingHeaders.length > 0) {
    throw new Error(
      `Property operating obligation CSV is missing required headers: ${missingHeaders.join(", ")}.`,
    );
  }

  if (
    new Set(headers).size !==
    headers.length
  ) {
    throw new Error(
      "Property operating obligation CSV headers must be unique.",
    );
  }

  const rows =
    parsedRows
      .slice(1)
      .map(
        (cells, index) => {
          if (
            cells.length >
            headers.length
          ) {
            throw new Error(
              `Property operating obligation CSV row ${index + 2} contains more values than headers.`,
            );
          }

          return Object.freeze({
            rowNumber:
              index + 2,
            values:
              Object.freeze(
                Object.fromEntries(
                  headers.map(
                    (
                      header,
                      columnIndex,
                    ) => [
                      header,
                      String(
                        cells[
                          columnIndex
                        ] ?? "",
                      ).trim(),
                    ],
                  ),
                ),
              ),
          });
        },
      )
      .filter(
        ({ values }) =>
          values.property
            .toLowerCase() !==
              "totals",
      );

  return Object.freeze({
    headers:
      Object.freeze([
        ...headers,
      ]),
    rows:
      Object.freeze(rows),
  });
}

function addressKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bstreet\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/\bwest\b/g, "w")
    .replace(/\beast\b/g, "e")
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function identifierKey(value) {
  return addressKey(value)
    .replace(/\s+/g, "-");
}

function propertyIdentity(property) {
  return String(
    property?.id ??
    property?.propertyId ??
    "",
  ).trim();
}

function propertyKeys(property) {
  return new Set(
    [
      property?.id,
      property?.propertyId,
      property?.address,
      property?.streetAddress,
      property?.name,
      property?.label,
    ]
      .map(addressKey)
      .filter(Boolean),
  );
}

function matchProperty(
  label,
  properties,
) {
  const requiredKey =
    addressKey(label);

  const matches =
    properties.filter(
      (property) =>
        propertyKeys(property)
          .has(requiredKey),
    );

  if (matches.length === 1) {
    return Object.freeze({
      status: "matched",
      property:
        matches[0],
    });
  }

  return Object.freeze({
    status:
      matches.length === 0
        ? "unmatched"
        : "ambiguous",
    property: null,
  });
}

function parsePaymentDate(value) {
  const match =
    String(value || "")
      .trim()
      .match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      );

  if (!match) {
    throw new Error(
      "Payment date must use M/D/YYYY format.",
    );
  }

  const month =
    Number(match[1]);
  const day =
    Number(match[2]);
  const year =
    Number(match[3]);
  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    date.getUTCFullYear() !==
      year ||
    date.getUTCMonth() !==
      month - 1 ||
    date.getUTCDate() !==
      day
  ) {
    throw new Error(
      "Payment date must be valid.",
    );
  }

  return [
    String(year).padStart(
      4,
      "0",
    ),
    String(month).padStart(
      2,
      "0",
    ),
    String(day).padStart(
      2,
      "0",
    ),
  ].join("-");
}

function dollarsToCents(value) {
  const amount =
    Number(
      String(value || "")
        .replace(/[$,\s]/g, ""),
    );

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    throw new Error(
      "Expense must be a nonnegative number.",
    );
  }

  const cents =
    Math.round(amount * 100);

  if (
    !Number.isSafeInteger(cents)
  ) {
    throw new Error(
      "Expense exceeds the supported range.",
    );
  }

  return cents;
}

function providerName(description) {
  const match =
    String(description || "")
      .match(/\(([^)]+)\)/);

  return match
    ? match[1].trim()
    : null;
}

function obligationType(
  description,
  portfolio,
) {
  const normalized =
    String(description || "")
      .toLowerCase();

  if (portfolio) {
    return "business_liability_insurance";
  }

  if (
    normalized.includes(
      "property tax",
    )
  ) {
    return "property_tax";
  }

  if (
    normalized.includes("wright") ||
    normalized.includes("flood")
  ) {
    return "flood_insurance";
  }

  if (
    normalized.includes(
      "windstorm",
    )
  ) {
    return "windstorm_insurance";
  }

  if (
    normalized.includes(
      "louis a williams",
    )
  ) {
    return "bundled_fire_windstorm_insurance";
  }

  if (
    normalized.includes(
      "farm bureau",
    )
  ) {
    return "fire_insurance";
  }

  return "other_insurance";
}

function isTax(description) {
  return String(
    description || "",
  )
    .toLowerCase()
    .includes("property tax");
}

function eventAmountCents(event) {
  if (
    Number.isSafeInteger(
      event?.amountCents,
    )
  ) {
    return Math.abs(
      event.amountCents,
    );
  }

  return Math.abs(
    Math.round(
      Number(event?.amount || 0) *
        100,
    ),
  );
}

function eventPropertyId(event) {
  const value =
    event?.propertyId ??
    event?.property_id ??
    null;

  return value == null
    ? null
    : String(value).trim();
}

function eventDate(event) {
  return String(
    event?.eventDate ??
    event?.event_date ??
    "",
  ).slice(0, 10);
}

function eventId(event) {
  return String(
    event?.id || "",
  ).trim();
}

function financialEventMatches({
  financialEvents,
  propertyId,
  paymentDate,
  paidAmountCents,
  portfolio,
}) {
  return financialEvents.filter(
    (event) => {
      if (
        eventDate(event) !==
          paymentDate ||
        eventAmountCents(event) !==
          paidAmountCents
      ) {
        return false;
      }

      const candidatePropertyId =
        eventPropertyId(event);

      return portfolio
        ? candidatePropertyId ===
            null
        : candidatePropertyId ===
            propertyId;
    },
  );
}

function deterministicId({
  paymentDate,
  propertyLabel,
  type,
  provider,
}) {
  return [
    "property_operating_obligation",
    paymentDate,
    identifierKey(
      propertyLabel,
    ),
    type,
    identifierKey(
      provider || "unknown",
    ),
  ].join("_");
}

function freeze(values) {
  return Object.freeze([
    ...values,
  ]);
}

export function previewPropertyOperatingObligationImport({
  csv,
  properties = [],
  financialEvents = [],
  taxServiceYear = 2025,
  clock = () =>
    new Date().toISOString(),
} = {}) {
  if (!Array.isArray(properties)) {
    throw new Error(
      "Property catalog must be an array.",
    );
  }

  if (
    !Array.isArray(
      financialEvents,
    )
  ) {
    throw new Error(
      "Financial events must be an array.",
    );
  }

  const parsed =
    parsePropertyOperatingObligationCsv(
      csv,
    );
  const obligations = [];
  const errors = [];
  const warnings = [];

  for (
    const {
      rowNumber,
      values,
    } of parsed.rows
  ) {
    try {
      const portfolio =
        addressKey(
          values.property,
        ) ===
          "business expenses";
      const matched =
        portfolio
          ? null
          : matchProperty(
              values.property,
              properties,
            );

      if (
        !portfolio &&
        matched.status !==
          "matched"
      ) {
        throw new Error(
          matched.status ===
            "ambiguous"
            ? `Property "${values.property}" matches more than one catalog property.`
            : `Property "${values.property}" was not found in the property catalog.`,
        );
      }

      const propertyId =
        portfolio
          ? null
          : propertyIdentity(
              matched.property,
            );

      if (
        !portfolio &&
        !propertyId
      ) {
        throw new Error(
          `Property "${values.property}" does not have an id.`,
        );
      }

      const paymentDate =
        parsePaymentDate(
          values.date,
        );
      const paidAmountCents =
        dollarsToCents(
          values.expense,
        );
      const tax =
        isTax(
          values.description,
        );
      const type =
        obligationType(
          values.description,
          portfolio,
        );
      const provider =
        providerName(
          values.description,
        );
      const matches =
        financialEventMatches({
          financialEvents,
          propertyId,
          paymentDate,
          paidAmountCents,
          portfolio,
        });
      const reconciledId =
        matches.length === 1
          ? eventId(matches[0])
          : null;

      if (matches.length === 0) {
        warnings.push(
          Object.freeze({
            rowNumber,
            code:
              "financial_event_not_matched",
            message:
              "No unique imported financial payment was matched.",
          }),
        );
      } else if (
        matches.length > 1
      ) {
        warnings.push(
          Object.freeze({
            rowNumber,
            code:
              "financial_event_ambiguous",
            message:
              "More than one imported financial payment matched this row.",
          }),
        );
      }

      const createdAt =
        new Date(
          clock(),
        ).toISOString();

      obligations.push(
        createPropertyOperatingObligation({
          id:
            deterministicId({
              paymentDate,
              propertyLabel:
                values.property,
              type,
              provider,
            }),
          scope:
            portfolio
              ? "portfolio"
              : "property",
          propertyId,
          subjectLabel:
            `${values.property} ${tax ? "2025 property taxes" : "annual insurance"}`,
          obligationType: type,
          annualAmountCents:
            paidAmountCents,
          currencyCode: "USD",
          servicePeriodStart:
            tax
              ? `${taxServiceYear}-01-01`
              : null,
          servicePeriodEnd:
            tax
              ? `${taxServiceYear + 1}-01-01`
              : null,
          paymentDate,
          paidAmountCents,
          status: "active",
          verificationStatus:
            "owner_confirmed",
          recognitionStatus:
            tax
              ? "accrual_ready"
              : "pending",
          businessUseBasisPoints:
            null,
          source: "spreadsheet",
          providerName:
            provider,
          providerReference:
            null,
          evidenceId: null,
          reconciledFinancialEventId:
            reconciledId,
          cancelledAt: null,
          createdAt,
          updatedAt:
            createdAt,
          notes:
            tax
              ? `Annual ${taxServiceYear} property taxes paid ${paymentDate}.`
              : "Annual premium confirmed active by owner; coverage dates require policy verification.",
        }),
      );
    } catch (error) {
      errors.push(
        Object.freeze({
          rowNumber,
          property:
            values.property,
          message:
            error instanceof Error
              ? error.message
              : "Unable to preview obligation row.",
        }),
      );
    }
  }

  return Object.freeze({
    valid:
      errors.length === 0,
    rowCount:
      parsed.rows.length,
    validRowCount:
      obligations.length,
    invalidRowCount:
      errors.length,
    obligationCount:
      obligations.length,
    obligations:
      freeze(obligations),
    errors:
      freeze(errors),
    warnings:
      freeze(warnings),
  });
}
