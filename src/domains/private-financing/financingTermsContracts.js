// Versioned, immutable account-level schedule/allocation/prepayment terms -- the V1 Terms Generalization
// checkpoint's second new entity, alongside the generalized financing component
// (privateFinancingContracts.js). A financing component says WHAT is owed (principal, rate); an account
// terms version says HOW payments are scheduled and allocated across components. Both are insert-only,
// versioned, and resolved by effective date at replay time (see replayEvents.js) -- never mutated in
// place, matching the exact discipline the migration's own component version-ordering trigger already
// established for components.

import {
  MalformedPrivateFinancingContractError,
  PRIVATE_FINANCING_ALLOCATION_POLICY,
  PRIVATE_FINANCING_DAY_COUNT_CONVENTION,
  PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY,
  PRIVATE_FINANCING_PAYMENT_FREQUENCY,
  PRIVATE_FINANCING_PREPAYMENT_POLICY,
  isValidISODateOnly,
} from "./privateFinancingContracts.js";

function fail(contractName, reason) {
  throw new MalformedPrivateFinancingContractError(contractName, reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// The single, closed set of financing types V1 supports at the domain/schema level. seller_financing may
// optionally link to a property/site record later (still no propertyId column exists -- see SF-1
// Checkpoint D's own Revision 3); personal_loan always works without one. Neither type is the platform
// default; both are equally real product configurations.
export const PRIVATE_FINANCING_PRODUCT = Object.freeze({
  SELLER_FINANCED_REAL_ESTATE: "seller_financing",
  PERSONAL_LOAN: "personal_loan",
});

// Validates one version of an account's schedule/allocation/prepayment terms. Fail-closed on every axis:
// an unrecognized paymentFrequency/allocationPolicy/extraPaymentAllocationPolicy/prepaymentPolicy value is
// rejected here, at the shape layer, before it can ever reach the calculation engine -- "unsupported terms
// fail closed" is enforced structurally, not left to each calculation function to remember individually.
export function validateFinancingAccountTermsVersion(terms) {
  const contractName = "PrivateFinancingAccountTermsVersion";
  if (typeof terms !== "object" || terms === null || Array.isArray(terms)) fail(contractName, "must be an object");
  if (!isNonEmptyString(terms.ownerId)) fail(contractName, "ownerId must be a non-empty string");
  if (!isNonEmptyString(terms.id)) fail(contractName, "id must be a non-empty string");
  if (!isNonEmptyString(terms.accountId)) fail(contractName, "accountId must be a non-empty string");
  if (!Number.isInteger(terms.versionNumber) || terms.versionNumber < 1) fail(contractName, "versionNumber must be a positive integer");

  if (!Object.values(PRIVATE_FINANCING_PAYMENT_FREQUENCY).includes(terms.paymentFrequency)) {
    fail(
      contractName,
      `paymentFrequency "${terms.paymentFrequency}" is not supported by V1 -- only ${Object.values(PRIVATE_FINANCING_PAYMENT_FREQUENCY).join(", ")} has deterministic date/arrears tests. The schema may reserve other values for a future, fully-tested release.`,
    );
  }
  if (!isValidISODateOnly(terms.firstPaymentDueDate)) fail(contractName, "firstPaymentDueDate must be a valid ISO date string");
  if (!Number.isInteger(terms.regularScheduledPaymentAmountCents) || terms.regularScheduledPaymentAmountCents < 0) {
    fail(contractName, "regularScheduledPaymentAmountCents must be a non-negative integer");
  }
  if (terms.maturityDate !== undefined && terms.maturityDate !== null && !isValidISODateOnly(terms.maturityDate)) {
    fail(contractName, "maturityDate must be a valid ISO date string or null");
  }
  if (!Object.values(PRIVATE_FINANCING_ALLOCATION_POLICY).includes(terms.allocationPolicy)) {
    fail(contractName, `allocationPolicy must be one of ${Object.values(PRIVATE_FINANCING_ALLOCATION_POLICY).join(", ")}`);
  }
  if (!Object.values(PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY).includes(terms.extraPaymentAllocationPolicy)) {
    fail(
      contractName,
      `extraPaymentAllocationPolicy must be one of ${Object.values(PRIVATE_FINANCING_EXTRA_PAYMENT_ALLOCATION_POLICY).join(", ")}`,
    );
  }
  if (!Object.values(PRIVATE_FINANCING_PREPAYMENT_POLICY).includes(terms.prepaymentPolicy)) {
    fail(contractName, `prepaymentPolicy must be one of ${Object.values(PRIVATE_FINANCING_PREPAYMENT_POLICY).join(", ")}`);
  }
  if (terms.dayCountConvention !== PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365) {
    fail(contractName, `dayCountConvention must be ${PRIVATE_FINANCING_DAY_COUNT_CONVENTION.ACTUAL_365}`);
  }
  if (!isValidISODateOnly(terms.effectiveDate)) fail(contractName, "effectiveDate must be a valid ISO date string");
  if (!isNonEmptyString(terms.actingSellerId)) fail(contractName, "actingSellerId must be a non-empty string");
  if (terms.versionNumber > 1 && !isNonEmptyString(terms.amendmentReason)) {
    fail(contractName, "amendmentReason is required for any version after the first");
  }
  if (terms.amendmentReason !== undefined && terms.amendmentReason !== null && typeof terms.amendmentReason !== "string") {
    fail(contractName, "amendmentReason must be a string or null when present");
  }

  return Object.freeze({
    ownerId: terms.ownerId,
    id: terms.id,
    accountId: terms.accountId,
    versionNumber: terms.versionNumber,
    paymentFrequency: terms.paymentFrequency,
    firstPaymentDueDate: terms.firstPaymentDueDate,
    regularScheduledPaymentAmountCents: terms.regularScheduledPaymentAmountCents,
    maturityDate: terms.maturityDate ?? null,
    allocationPolicy: terms.allocationPolicy,
    extraPaymentAllocationPolicy: terms.extraPaymentAllocationPolicy,
    prepaymentPolicy: terms.prepaymentPolicy,
    dayCountConvention: terms.dayCountConvention,
    effectiveDate: terms.effectiveDate,
    actingSellerId: terms.actingSellerId,
    amendmentReason: terms.amendmentReason ?? null,
  });
}

// Resolves the single terms version in effect on a given date from a full version history -- the latest
// version whose effectiveDate is on or before asOfDate. Mirrors exactly how component versions are
// resolved (see resolveComponentsAsOf in replayEvents.js): a later amendment applies prospectively only,
// never rewriting how an earlier date replays. Throws if no version is effective yet as of asOfDate (an
// account cannot be replayed before its first terms version takes effect).
export function resolveAccountTermsAsOf(termsVersions, asOfDate) {
  const eligible = termsVersions.filter((version) => version.effectiveDate <= asOfDate).sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : b.versionNumber - a.versionNumber));
  if (eligible.length === 0) {
    throw new MalformedPrivateFinancingContractError("PrivateFinancingAccountTermsVersion", `no account terms version is effective as of ${asOfDate}`);
  }
  return eligible[0];
}
