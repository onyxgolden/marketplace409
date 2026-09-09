// A group is created only by an explicit human action (via the SECURITY DEFINER RPCs) --
// nothing in this domain ever infers a group from name/balance/institution similarity. See
// supabase/migrations/20260909080000_create_financial_account_groups.sql for the full schema
// and constraint rationale.
export const FINANCIAL_ACCOUNT_GROUP_COVERAGE_STATUSES = [
  "not_started",
  "importing",
  "pending_reconciliation",
  "reconciled",
  "stale_retry_detected",
] as const;
export type FinancialAccountGroupCoverageStatus = (typeof FINANCIAL_ACCOUNT_GROUP_COVERAGE_STATUSES)[number];

export type FinancialAccountGroup = Readonly<{
  id: string;
  ownerId: string;
  relationship: "same_real_account";
  balanceAuthorityAccountId: string | null;
  transactionCoverageStatus: FinancialAccountGroupCoverageStatus;
  transactionCoverageVerifiedByUserId: string | null;
  transactionCoverageVerifiedAt: string | null;
  transactionCutoverAt: string | null;
  transactionCutoverTimezone: "UTC";
  createdByUserId: string;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
  note: string | null;
}>;

export type FinancialAccountGroupMember = Readonly<{
  id: string;
  groupId: string;
  financialAccountId: string;
  ownerId: string;
  confirmedByUserId: string;
  confirmedAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}>;

// A group with its currently-active members joined in -- the shape FinancialPositionQueryService
// and FinancialWorkspaceQueryService actually consume. Revoked members are never included here;
// they are historical and only ever surfaced by a direct account-detail/history query.
export type FinancialAccountGroupWithActiveMembers = Readonly<{
  group: FinancialAccountGroup;
  activeMemberFinancialAccountIds: readonly string[];
}>;
