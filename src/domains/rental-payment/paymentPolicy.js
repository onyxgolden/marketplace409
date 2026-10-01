// Rentec-parity R11: payment policies (allow any amount / require rent /
// require balance) + per-tenant override.
//
// Pure domain logic for the portfolio payment policy. The API routes are the
// enforcement authority; these functions exist so the UI and API validate and
// explain with the exact same arithmetic -- the messages are Brandy-readable
// plain English, never codes.
//
// Policy semantics (Rentec item 12a):
// - allow_any_amount: the tenant may pay any positive amount (the historic
//   FORGE behavior; the default for every workspace, including existing ones).
// - require_rent: a payment must cover at least one month's rent.
// - require_balance: a payment must cover the tenant's full outstanding balance.
// Boundary amounts pass: paying exactly one month's rent (or exactly the full
// balance) satisfies require_rent (or require_balance).
//
// Stripe autopay is EXEMPT from policy gating by design: autopay amounts are
// computed from the consented enrollment schedule, never tenant-entered.
// The policy governs tenant-initiated payment amounts (portal payment
// submission, owner manual recording) only.

export const PAYMENT_POLICY_ALLOW_ANY_AMOUNT = "allow_any_amount";
export const PAYMENT_POLICY_REQUIRE_RENT = "require_rent";
export const PAYMENT_POLICY_REQUIRE_BALANCE = "require_balance";
export const DEFAULT_PAYMENT_POLICY = PAYMENT_POLICY_ALLOW_ANY_AMOUNT;

export const PAYMENT_POLICIES = [
  PAYMENT_POLICY_ALLOW_ANY_AMOUNT,
  PAYMENT_POLICY_REQUIRE_RENT,
  PAYMENT_POLICY_REQUIRE_BALANCE,
];

export function isPaymentPolicy(value) {
  return PAYMENT_POLICIES.includes(value);
}

// Plain-English labels and explanations for the settings UI -- owner-facing.
export function paymentPolicyLabel(policy) {
  switch (policy) {
    case PAYMENT_POLICY_ALLOW_ANY_AMOUNT: return "Allow any amount";
    case PAYMENT_POLICY_REQUIRE_RENT: return "Require one month's rent";
    case PAYMENT_POLICY_REQUIRE_BALANCE: return "Require full balance";
    default: return "Allow any amount";
  }
}

export function paymentPolicyDescription(policy) {
  switch (policy) {
    case PAYMENT_POLICY_ALLOW_ANY_AMOUNT:
      return "Tenants may pay any positive amount, including partial payments.";
    case PAYMENT_POLICY_REQUIRE_RENT:
      return "Every payment must cover at least one full month's rent. Partial payments below one month's rent are declined.";
    case PAYMENT_POLICY_REQUIRE_BALANCE:
      return "Every payment must cover the tenant's full outstanding balance. Anything less is declined.";
    default:
      return "Tenants may pay any positive amount, including partial payments.";
  }
}

// Tenant-facing explanation used when a payment is declined or shown in the
// portal: states the rule and the concrete minimum in the same sentence.
export function paymentPolicyTenantExplanation(policy, minimumCents) {
  const minimum = formatCents(minimumCents);
  switch (policy) {
    case PAYMENT_POLICY_REQUIRE_RENT:
      return `Your payment must be at least one month's rent (${minimum}).`;
    case PAYMENT_POLICY_REQUIRE_BALANCE:
      return `Your payment must cover the full balance of ${minimum}.`;
    default:
      return `You may pay any amount.`;
  }
}

// Tenant-level override beats the workspace default; null inherits; anything
// unrecognized (bad row, future value) fails safe to the permissive default.
export function resolveEffectivePaymentPolicy(tenantPolicy, workspacePolicy) {
  if (isPaymentPolicy(tenantPolicy)) return tenantPolicy;
  if (isPaymentPolicy(workspacePolicy)) return workspacePolicy;
  return DEFAULT_PAYMENT_POLICY;
}

export function paymentPolicyIsOverride(tenantPolicy) {
  return isPaymentPolicy(tenantPolicy);
}

// Minimum acceptable payment for a policy: cents. allow_any_amount has no
// minimum (any positive amount passes); require_rent needs one month's rent;
// require_balance needs the full outstanding balance. A zero/unknown rent or
// balance falls back to allow_any_amount behavior so a bad reference can never
// newly block a tenant (fail-open only when the gate inputs are missing).
export function minimumPaymentCents(policy, rentCents, balanceCents) {
  if (policy === PAYMENT_POLICY_REQUIRE_RENT && Number.isSafeInteger(rentCents) && rentCents > 0) return rentCents;
  if (policy === PAYMENT_POLICY_REQUIRE_BALANCE && Number.isSafeInteger(balanceCents) && balanceCents > 0) return balanceCents;
  return 1; // allow_any_amount: any positive amount
}

// Server-side gate. Returns { ok: true } or { ok: false, message } where the
// message is the exact Brandy-readable decline the route returns (HTTP 422).
// amountCents must be positive (the routes reject non-positive first); unknown
// reference amounts (rent/balance) fail open to any positive amount so a bad
// reference can never newly block a tenant.
export function checkPaymentAmountAgainstPolicy({ policy, amountCents, rentCents = null, balanceCents = null }) {
  const effective = isPaymentPolicy(policy) ? policy : DEFAULT_PAYMENT_POLICY;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, message: "A positive payment amount is required." };
  }
  if (effective === PAYMENT_POLICY_REQUIRE_RENT) {
    if (Number.isSafeInteger(rentCents) && rentCents > 0 && amountCents < rentCents) {
      return { ok: false, message: paymentPolicyTenantExplanation(PAYMENT_POLICY_REQUIRE_RENT, rentCents) };
    }
    return { ok: true };
  }
  if (effective === PAYMENT_POLICY_REQUIRE_BALANCE) {
    if (Number.isSafeInteger(balanceCents) && balanceCents > 0 && amountCents < balanceCents) {
      return { ok: false, message: paymentPolicyTenantExplanation(PAYMENT_POLICY_REQUIRE_BALANCE, balanceCents) };
    }
    return { ok: true };
  }
  return { ok: true };
}

function formatCents(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}
