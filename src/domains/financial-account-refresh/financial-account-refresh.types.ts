// Generic, provider-neutral: any future connected provider (Plaid included) can use this same
// per-(financial_account_id, feature) refresh-work state machine -- nothing here is Stripe-
// specific. The Stripe-specific piece (deciding, via a live read-only retrieve, which refresh_id
// is currently authoritative) lives in the adapter's own coordinator, not here.
export const FINANCIAL_ACCOUNT_REFRESH_FEATURES = ["balance", "transactions"] as const;
export type FinancialAccountRefreshFeature = (typeof FINANCIAL_ACCOUNT_REFRESH_FEATURES)[number];

export type FinancialAccountRefreshWatermark = Readonly<{
  financialAccountId: string;
  feature: FinancialAccountRefreshFeature;
  ownerId: string;
  committedRefreshId: string | null;
  committedRefreshLastAttemptedAt: number | null;
  committedAt: string | null;
}>;

// A caller must have already confirmed, via a live read-only retrieve against the provider, that
// refreshId is the CURRENT refresh for this account+feature before calling claim() -- the claim
// primitive itself makes no currency judgement, it only enforces per-account-per-feature
// exclusivity and crash-recoverable leasing. See claim_financial_account_refresh_work's own
// migration comment for why ordering is never decided by comparing timestamps in this layer.
export type ClaimRefreshWorkInput = Readonly<{
  financialAccountId: string;
  feature: FinancialAccountRefreshFeature;
  ownerId: string;
  refreshId: string;
  refreshLastAttemptedAt: number;
  triggeringEventId: string | null;
  leaseSeconds?: number;
}>;

export const CLAIM_OUTCOMES = ["claimed", "already_committed", "slot_busy"] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];

export type ClaimRefreshWorkResult = Readonly<{
  outcome: ClaimOutcome;
  workItemId: string;
}>;

export type CommitRefreshWorkInput = Readonly<{
  workItemId: string;
  financialAccountId: string;
  feature: FinancialAccountRefreshFeature;
  ownerId: string;
  refreshId: string;
  refreshLastAttemptedAt: number;
}>;

export const COMMIT_OUTCOMES = ["committed", "superseded"] as const;
export type CommitOutcome = (typeof COMMIT_OUTCOMES)[number];

export type CommitRefreshWorkResult = Readonly<{
  outcome: CommitOutcome;
  supersededByRefreshId: string | null;
}>;
