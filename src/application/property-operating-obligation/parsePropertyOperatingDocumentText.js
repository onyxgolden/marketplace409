function normalizedText(
  value,
) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function optionalMatch(
  text,
  pattern,
) {
  return (
    text.match(pattern)?.[1]
      ?.trim() ||
    null
  );
}

function moneyToCents(
  value,
) {
  if (!value) {
    return null;
  }

  const amount =
    Number(
      String(value)
        .replace(
          /[$,]/g,
          "",
        ),
    );

  return Number.isFinite(
    amount,
  )
    ? Math.round(
        amount * 100,
      )
    : null;
}

function dateOnly(
  value,
) {
  const match =
    String(value || "")
      .trim()
      .match(
        /^(\d{1,2})[-/–—](\d{1,2})[-/–—](\d{4})$/,
      );

  if (!match) {
    return null;
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
    return null;
  }

  return [
    year,
    String(month)
      .padStart(2, "0"),
    String(day)
      .padStart(2, "0"),
  ].join("-");
}

function insuranceDocument(
  text,
) {
  return (
    /\bpolicy\s+declarations?\b/i
      .test(text) ||
    /\bpolicy\s+period\b/i
      .test(text) ||
    /\btotal\s+premium\b/i
      .test(text)
  );
}

function taxDocument(
  text,
) {
  return (
    /\bproperty\s+tax\s+(?:statement|bill)\b/i
      .test(text) ||
    /\bad\s+valorem\s+tax\b/i
      .test(text) ||
    (
      /\btax\s+year\b/i
        .test(text) &&
      /\b(?:total\s+due|taxes\s+due)\b/i
        .test(text)
    )
  );
}

function inferPolicyTotalCents(
  text,
) {
  const totalsStart =
    text.search(
      /\bpolicy\s+totals?\b/i,
    );

  if (
    totalsStart === -1
  ) {
    return null;
  }

  const totalsBlock =
    text.slice(
      totalsStart,
    );

  if (
    !/\bpolicy\s+premium\b/i
      .test(totalsBlock) ||
    !/\btotal\s+taxes\s*(?:&|and)\s*fees\b/i
      .test(totalsBlock) ||
    !/\btotal\s+premium\b/i
      .test(totalsBlock)
  ) {
    return null;
  }

  const amounts =
    [
      ...totalsBlock.matchAll(
        /\$?\s*([\d,]+\.\d{2})\b/g,
      ),
    ]
      .map(
        (match) =>
          moneyToCents(
            match[1],
          ),
      )
      .filter(
        (amount) =>
          Number.isInteger(
            amount,
          ) &&
          amount > 0,
      );

  const candidates = [];

  for (
    let leftIndex = 0;
    leftIndex <
      amounts.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex =
        leftIndex + 1;
      rightIndex <
        amounts.length;
      rightIndex += 1
    ) {
      const sum =
        amounts[leftIndex] +
        amounts[rightIndex];

      if (
        amounts.includes(
          sum,
        )
      ) {
        candidates.push(
          sum,
        );
      }
    }
  }

  return candidates.length
    ? Math.max(
        ...candidates,
      )
    : null;
}

function insuranceProposal(
  text,
) {
  const period =
    text.match(
      /\bpolicy\s+period\s*:?[\s\S]{0,80}?from\s*:?\s*(\d{1,2}[-/–—]\d{1,2}[-/–—]\d{4})[\s\S]{0,50}?to\s*:?\s*(\d{1,2}[-/–—]\d{1,2}[-/–—]\d{4})/i,
    );
  const windExcluded =
    /\bwindstorm(?:\s+or\s+hail)?\s*:?\s*excluded\b/i
      .test(text) ||
    /\bwind(?:storm)?[\s/]+hail\s+excluded\b/i
      .test(text);
  const firePresent =
    /\bfire\b/i.test(
      text,
    );
  const windPresent =
    /\bwindstorm\b/i.test(
      text,
    );
  const policyPremiumCents =
    moneyToCents(
      optionalMatch(
        text,
        /\bpolicy\s+premium\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const taxesAndFeesCents =
    moneyToCents(
      optionalMatch(
        text,
        /\btotal\s+taxes\s*(?:&|and)\s*fees\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const totalPremiumCents =
    moneyToCents(
      optionalMatch(
        text,
        /\btotal\s+premium\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    ) ??
    inferPolicyTotalCents(
      text,
    );
  const locationTotalCents =
    moneyToCents(
      optionalMatch(
        text,
        /\blocation\s+total\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const dwellingLimitCents =
    moneyToCents(
      optionalMatch(
        text,
        /\b(?:a[-—]\s*)?dwelling\s*(?:\(acv\))?[\s$]*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const deductibleCents =
    moneyToCents(
      optionalMatch(
        text,
        /\bproperty\s*\(all\s+other\s+perils\)\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const providerName =
    optionalMatch(
      text,
      /\bunderwritten\s+by\s*:?\s*([^\n]+)/i,
    );
  const providerReference =
    optionalMatch(
      text,
      /\bpolicy\s+number\s*:?\s*([A-Za-z0-9-]+)/i,
    );
  const detectedAddress =
    optionalMatch(
      text,
      /\bthe\s+described\s+location\s*:?\s*([0-9][^\n]+)/i,
    );
  const obligationType =
    windExcluded &&
    firePresent
      ? "fire_insurance"
      : firePresent &&
          windPresent
        ? "bundled_fire_windstorm_insurance"
        : windPresent
          ? "windstorm_insurance"
          : "other_insurance";
  const annualAmountCents =
    totalPremiumCents ??
    (
      policyPremiumCents !==
        null &&
      taxesAndFeesCents !==
        null
        ? policyPremiumCents +
          taxesAndFeesCents
        : policyPremiumCents
    );
  const noteParts = [];

  if (
    dwellingLimitCents !==
      null
  ) {
    noteParts.push(
      `Dwelling limit ${formatMoney(
        dwellingLimitCents,
      )}.`,
    );
  }

  if (
    deductibleCents !==
      null
  ) {
    noteParts.push(
      `Other-perils deductible ${formatMoney(
        deductibleCents,
      )}.`,
    );
  }

  if (windExcluded) {
    noteParts.push(
      "Windstorm or hail excluded.",
    );
  }

  if (
    policyPremiumCents !==
      null &&
    taxesAndFeesCents !==
      null
  ) {
    noteParts.push(
      `Policy premium ${formatMoney(
        policyPremiumCents,
      )} plus ${formatMoney(
        taxesAndFeesCents,
      )} taxes and fees.`,
    );
  }

  return {
    obligationType,
    annualAmountCents,
    servicePeriodStart:
      dateOnly(
        period?.[1],
      ),
    servicePeriodEnd:
      dateOnly(
        period?.[2],
      ),
    providerName,
    providerReference,
    detectedAddress,
    taxYear: null,
    notes:
      noteParts.join(" ") ||
      null,
    facts: Object.freeze({
      policyPremiumCents,
      taxesAndFeesCents,
      totalPremiumCents,
      locationTotalCents,
      dwellingLimitCents,
      deductibleCents,
      windExcluded,
    }),
  };
}

function taxProposal(
  text,
) {
  const taxYearValue =
    optionalMatch(
      text,
      /\b(?:tax\s+year|property\s+tax\s+(?:statement|bill))\s*:?\s*(20\d{2})/i,
    ) ||
    optionalMatch(
      text,
      /\b(20\d{2})\s+property\s+tax\s+(?:statement|bill)\b/i,
    );
  const taxYear =
    taxYearValue
      ? Number(
          taxYearValue,
        )
      : null;
  const annualAmountCents =
    moneyToCents(
      optionalMatch(
        text,
        /\b(?:total\s+due|taxes\s+due|total\s+tax)\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i,
      ),
    );
  const providerReference =
    optionalMatch(
      text,
      /\b(?:account|parcel)\s*(?:number|no\.?|#)\s*:?\s*([A-Za-z0-9-]+)/i,
    );
  const detectedAddress =
    optionalMatch(
      text,
      /\b(?:property|situs)\s+address\s*:?\s*([^\n]+)/i,
    );
  const providerName =
    optionalMatch(
      text,
      /^([^\n]+(?:tax\s+office|appraisal\s+district|tax\s+assessor[^\n]*))$/im,
    );

  return {
    obligationType:
      "property_tax",
    annualAmountCents,
    servicePeriodStart:
      taxYear
        ? `${taxYear}-01-01`
        : null,
    servicePeriodEnd:
      taxYear
        ? `${taxYear + 1}-01-01`
        : null,
    providerName,
    providerReference,
    detectedAddress,
    taxYear,
    notes:
      taxYear
        ? `Annual ${taxYear} property taxes extracted from the tax document.`
        : "Property-tax document detected; confirm the tax year.",
    facts:
      Object.freeze({}),
  };
}

function formatMoney(
  cents,
) {
  return `$${(
    cents / 100
  ).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    },
  )}`;
}

function confidenceFor({
  documentType,
  proposal,
}) {
  const complete =
    proposal
      .annualAmountCents !==
        null &&
    proposal
      .servicePeriodStart &&
    proposal
      .servicePeriodEnd;

  if (
    documentType !==
      "unknown" &&
    complete
  ) {
    return "high";
  }

  if (
    documentType !==
      "unknown"
  ) {
    return "medium";
  }

  return "low";
}

export function parsePropertyOperatingDocumentText(
  documentText,
) {
  const text =
    normalizedText(
      documentText,
    );

  if (!text) {
    throw new Error(
      "Property operating document text is required.",
    );
  }

  const documentType =
    insuranceDocument(
      text,
    )
      ? "insurance_policy"
      : taxDocument(
            text,
          )
        ? "property_tax_statement"
        : "unknown";

  const proposal =
    documentType ===
      "insurance_policy"
      ? insuranceProposal(
          text,
        )
      : documentType ===
          "property_tax_statement"
        ? taxProposal(
            text,
          )
        : {
            obligationType:
              null,
            annualAmountCents:
              null,
            servicePeriodStart:
              null,
            servicePeriodEnd:
              null,
            providerName:
              null,
            providerReference:
              null,
            detectedAddress:
              null,
            taxYear:
              null,
            notes: null,
            facts:
              Object.freeze({}),
          };

  const warnings = [];

  if (
    proposal
      .annualAmountCents ===
        null
  ) {
    warnings.push(
      "Annual amount requires review.",
    );
  }

  if (
    !proposal
      .servicePeriodStart ||
    !proposal
      .servicePeriodEnd
  ) {
    warnings.push(
      "Service-period dates require review.",
    );
  }

  if (
    documentType ===
      "unknown"
  ) {
    warnings.push(
      "Document type requires review.",
    );
  }

  return Object.freeze({
    parserVersion:
      "property-operating-document-v1",
    requiresReview: true,
    confidence:
      confidenceFor({
        documentType,
        proposal,
      }),
    documentType,
    proposal:
      Object.freeze(
        proposal,
      ),
    warnings:
      Object.freeze(
        warnings,
      ),
  });
}
