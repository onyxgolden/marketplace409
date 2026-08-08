const COMPONENT_PATTERNS =
Object.freeze([
  Object.freeze({
    componentType: "filter_drier",
    pattern: /\bfilter\s+dri(?:er|yer)\b/i,
  }),
  Object.freeze({
    componentType: "refrigerant_line_set",
    pattern: /\b(?:suction|refrigerant)\s+line\b|\bline\s+set\b/i,
  }),
  Object.freeze({
    componentType: "contactor",
    pattern: /\bcontactor\b/i,
  }),
  Object.freeze({
    componentType: "capacitor",
    pattern: /\bcapacitor\b/i,
  }),
  Object.freeze({
    componentType: "low_voltage_wiring",
    pattern: /\blow[-\s]?voltage\s+wir(?:e|ing)\b/i,
  }),
  Object.freeze({
    componentType: "condenser_coil",
    pattern: /\bcondenser\s+coil\b/i,
  }),
]);

function normalizedText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function optionalMatch(text, pattern) {
  return text.match(pattern)?.[1]?.trim() || null;
}

function moneyToCents(value) {
  if (!value) {
    return null;
  }

  const amount = Number(
    value.replace(/,/g, ""),
  );

  return Number.isFinite(amount)
    ? Math.round(amount * 100)
    : null;
}

function invoiceDate(text) {
  const value =
    optionalMatch(
      text,
      /\b(?:service\s+date|invoice\s+date|date)\s*[:#]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    ) ||
    optionalMatch(
      text,
      /\b(?:service\s+date|invoice\s+date|date)\s*[:#]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    );

  if (!value) {
    return null;
  }

  const parsed = new Date(
    `${value} UTC`,
  );

  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString();
}

function action({
  actionType,
  componentType = null,
  description,
  quantity = null,
  unit = null,
}) {
  return Object.freeze({
    actionType,
    componentId: null,
    componentType,
    description,
    quantity,
    unit,
    allocatedCostCents: null,
  });
}

function includes(text, pattern) {
  return pattern.test(text);
}

export function parseHVACInvoiceText(
  invoiceText,
) {
  const text =
    normalizedText(invoiceText);

  if (!text) {
    throw new Error(
      "HVAC invoice text is required.",
    );
  }

  const actions = [];

  if (
    includes(
      text,
      /\bfilter\s+dri(?:er|yer)\b[\s\S]{0,100}\breplac/i,
    ) ||
    includes(
      text,
      /\breplac(?:ed|ement)[\s\S]{0,100}\bfilter\s+dri(?:er|yer)\b/i,
    )
  ) {
    actions.push(
      action({
        actionType: "replaced",
        componentType:
          "filter_drier",
        description:
          "Replaced refrigerant filter drier.",
      }),
    );
  }

  if (
    includes(
      text,
      /\b(?:suction|refrigerant)\s+line\b[\s\S]{0,120}\b(?:weld|leak|repair)/i,
    )
  ) {
    actions.push(
      action({
        actionType: "repaired",
        componentType:
          "refrigerant_line_set",
        description:
          "Repaired suction-line weld and leak.",
      }),
    );
  }

  if (
    includes(
      text,
      /\bcontactor\b[\s\S]{0,100}\b(?:welded|replac)/i,
    )
  ) {
    actions.push(
      action({
        actionType: "replaced",
        componentType: "contactor",
        description:
          "Replaced welded contactor.",
      }),
    );
  }

  if (
    includes(
      text,
      /\bcapacitor\b[\s\S]{0,100}\b(?:range|weak|failed|replac)/i,
    )
  ) {
    actions.push(
      action({
        actionType: "replaced",
        componentType: "capacitor",
        description:
          "Replaced out-of-range capacitor.",
      }),
    );
  }

  if (
    includes(
      text,
      /\blow[-\s]?voltage\s+wir(?:e|ing)\b[\s\S]{0,120}\b(?:damag|repair|rerout)/i,
    )
  ) {
    actions.push(
      action({
        actionType: "repaired",
        componentType:
          "low_voltage_wiring",
        description:
          "Repaired and rerouted damaged low-voltage wiring.",
      }),
    );
  }

  if (
    includes(
      text,
      /\bcondenser\s+coil\b[\s\S]{0,80}\bclean/i,
    ) ||
    includes(
      text,
      /\bclean(?:ed|ing)[\s\S]{0,80}\bcondenser\s+coil\b/i,
    )
  ) {
    actions.push(
      action({
        actionType: "cleaned",
        componentType:
          "condenser_coil",
        description:
          "Cleaned condenser coil.",
      }),
    );
  }

  const refrigerantQuantity =
    optionalMatch(
      text,
      /\b(?:charged|recharged|added)\s+(?:with\s+)?(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\b/i,
    ) ||
    optionalMatch(
      text,
      /\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|pounds?)\s+(?:of\s+)?r[-\s]?410a\b/i,
    );

  if (
    refrigerantQuantity ||
    includes(
      text,
      /\b(?:charged|recharged)\b[\s\S]{0,80}\br[-\s]?410a\b/i,
    )
  ) {
    actions.push(
      action({
        actionType: "recharged",
        description:
          "Evacuated and charged system with R-410A refrigerant.",
        quantity:
          refrigerantQuantity
            ? Number(
                refrigerantQuantity,
              )
            : null,
        unit:
          refrigerantQuantity
            ? "pounds"
            : null,
      }),
    );
  }

  if (
    includes(
      text,
      /\bpressure\s+test/i,
    )
  ) {
    actions.push(
      action({
        actionType: "tested",
        description:
          "Pressure tested the refrigerant system.",
      }),
    );
  }

  if (
    includes(
      text,
      /\b(?:pulled\s+(?:a\s+)?vacuum|vacuumed|evacuat)/i,
    )
  ) {
    actions.push(
      action({
        actionType: "tested",
        description:
          "Evacuated the refrigerant system and verified vacuum.",
      }),
    );
  }

  const componentTypes =
    COMPONENT_PATTERNS
      .filter(({ pattern }) =>
        pattern.test(text),
      )
      .map(
        ({ componentType }) =>
          componentType,
      );

  return Object.freeze({
    parserVersion:
      "hvac-invoice-v1",
    requiresReview: true,
    confidence:
      actions.length > 0
        ? "high"
        : "low",
    event: Object.freeze({
      eventType: "serviced",
      occurredAt:
        invoiceDate(text),
      failureSymptoms:
        includes(
          text,
          /\bflat\s+on\s+refrigerant\b/i,
        )
          ? "System was flat on refrigerant."
          : null,
      workPerformed:
        actions.length > 0
          ? actions
              .map(
                ({ description }) =>
                  description,
              )
              .join(" ")
          : null,
      costCents:
        moneyToCents(
          optionalMatch(
            text,
            /\btotal\s*[:$]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
          ),
        ),
      vendorName:
        optionalMatch(
          text,
          /^([^\n]+(?:air conditioning|heating|hvac)[^\n]*)$/im,
        ),
      invoiceReference:
        optionalMatch(
          text,
          /\binvoice\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Za-z0-9-]+)/i,
        ),
      notes:
        "Generated from invoice text. Review all proposed values before saving.",
      componentActions:
        Object.freeze(actions),
    }),
    detectedComponentTypes:
      Object.freeze(
        Array.from(
          new Set(componentTypes),
        ),
      ),
  });
}
