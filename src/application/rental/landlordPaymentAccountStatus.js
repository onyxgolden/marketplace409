// Shared, pure status-rollup logic for a landlord's Stripe Connect account. Used by both the
// stripe-account route (landlord-initiated GET/POST sync) and the V2 account thin-event webhook,
// so the two paths can never silently drift into disagreeing about what "enabled" means.
//
// `landlord_payment_accounts.status` is constrained by a DB CHECK to
// ('not_started','onboarding','restricted','enabled','disabled') — this function only ever
// returns 'onboarding' | 'restricted' | 'enabled' | 'disabled' from live Stripe data ('not_started'
// is reserved for a row that has no connected account at all, which this function is never called
// for). It never returns 'enabled' unless charges and payouts are both genuinely active, matching
// the table's own `check (status <> 'enabled' or (... charges_enabled and payouts_enabled))`.
export function resolveLandlordPaymentAccountStatus(accountStatus) {
  if (accountStatus.accountClosed) return "disabled";
  if (accountStatus.chargesEnabled && accountStatus.payoutsEnabled) return "enabled";
  if (!accountStatus.onboardingStarted) return "onboarding";
  return "restricted";
}

// Maps a StripeBillingProvider#retrieveAccountStatus() result onto the exact column set of
// landlord_payment_accounts, so both call sites build an identical update payload.
export function buildLandlordPaymentAccountUpdate(accountStatus) {
  return Object.freeze({
    status: resolveLandlordPaymentAccountStatus(accountStatus),
    provider_mode: accountStatus.mode,
    details_submitted: accountStatus.onboardingStarted,
    charges_enabled: accountStatus.chargesEnabled,
    payouts_enabled: accountStatus.payoutsEnabled,
    ach_debit_enabled: accountStatus.achDebitEnabled,
    card_payments_enabled: accountStatus.cardPaymentsEnabled,
    requirements_due: accountStatus.requirementsDue,
    updated_at: new Date().toISOString(),
  });
}
