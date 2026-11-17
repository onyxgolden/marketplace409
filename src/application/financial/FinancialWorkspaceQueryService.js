import {
  financialEventAggregationService,
} from "../../domains/financial-workspace/index.js";

// Half-open interval, no overlap, no gap, applied ONLY for a group whose
// transaction_coverage_status is 'reconciled', whose transaction_authority_account_id has been
// explicitly identified, AND whose transaction_cutover_at has been explicitly set (all three
// require a human confirmation -- see advance_financial_account_group_coverage_status/
// set_financial_account_group_transaction_authority/set_financial_account_group_transaction_
// cutover, in that order -- the cutover RPC itself refuses to run until transaction authority is
// set). transaction_cutover_at is a plain SQL date, and financial_events.event_date is stored the
// same way -- both write paths (Stripe's transactedAt truncation and the Simplifi CSV parser)
// were confirmed to already be UTC-anchored, independent of server timezone, so this string
// comparison needs no timezone conversion of its own.
//
// The canonical/live side of a group is transactionAuthorityAccountId -- a SEPARATE pointer from
// balanceAuthorityAccountId, never assumed equal to it. A 3-member group can easily have Plaid as
// balance authority (freshest live balance right now) while Stripe is transaction authority
// (the member whose transaction history a human has actually verified complete) -- using
// balanceAuthorityAccountId here would silently take over transaction history for whichever
// account happens to be winning the balance race today, which is not something anyone confirmed.
function buildCutoverRuleByAccountId(groupsWithMembers) {
  const cutoverByAccountId = new Map();

  for (const { group, activeMemberFinancialAccountIds } of groupsWithMembers) {
    if (
      group.transactionCoverageStatus !== "reconciled" ||
      !group.transactionAuthorityAccountId ||
      !group.transactionCutoverAt
    ) {
      continue;
    }

    for (const financialAccountId of activeMemberFinancialAccountIds) {
      cutoverByAccountId.set(financialAccountId, {
        isCanonical: financialAccountId === group.transactionAuthorityAccountId,
        cutoverAt: group.transactionCutoverAt,
      });
    }
  }

  return cutoverByAccountId;
}

function isExcludedByCutover(event, cutoverByAccountId) {
  const rule = cutoverByAccountId.get(event.financial_account_id);
  if (!rule) return false; // not part of any reconciled group -- never filtered
  if (rule.isCanonical) return false; // the provider side is always authoritative going forward
  // Linked/manual side: retained strictly before the cutover date, excluded on/after it -- the
  // canonical side owns that range instead. No CSV/manual row is ever deleted by this filter --
  // it is applied at read time only.
  return event.event_date >= rule.cutoverAt;
}

/**
 * FinancialWorkspaceQueryService
 *
 * Application-layer orchestration for repository-backed financial workspace
 * queries. Repository access remains behind FinancialEventRepository while
 * financial calculations remain inside FinancialEventAggregationService.
 */
export class FinancialWorkspaceQueryService {
  constructor({
    financialEventRepository,
    aggregationService = financialEventAggregationService,
    // Optional, deliberately -- see FinancialPositionQueryService's own constructor comment.
    // Absent entirely, this service's behavior is byte-for-byte unchanged.
    financialAccountGroupRepository = null,
    // Slice 3 (load-times): the dashboard SQL-aggregation repository.
    // Absent entirely, buildDashboardSummary throws explicitly -- it must
    // never silently fall back to the legacy full-history scan, or the
    // dashboard would pay the old cost while reporting summary mode.
    dashboardFinancialSummaryRepository = null,
  } = {}) {
    if (!financialEventRepository) {
      throw new Error(
        "FinancialWorkspaceQueryService requires a financial event repository.",
      );
    }

    if (!aggregationService) {
      throw new Error(
        "FinancialWorkspaceQueryService requires an aggregation service.",
      );
    }

    if (
      typeof financialEventRepository.findByOwnerId !== "function"
    ) {
      throw new Error(
        "FinancialWorkspaceQueryService requires a repository with findByOwnerId.",
      );
    }

    if (typeof aggregationService.aggregate !== "function") {
      throw new Error(
        "FinancialWorkspaceQueryService requires an aggregation service with aggregate.",
      );
    }

    if (
      dashboardFinancialSummaryRepository !== null &&
      typeof dashboardFinancialSummaryRepository.getSummary !==
        "function"
    ) {
      throw new Error(
        "FinancialWorkspaceQueryService requires a dashboard financial summary repository with getSummary.",
      );
    }

    this.financialEventRepository = financialEventRepository;
    this.aggregationService = aggregationService;
    this.financialAccountGroupRepository = financialAccountGroupRepository;
    this.dashboardFinancialSummaryRepository =
      dashboardFinancialSummaryRepository;

    Object.freeze(this);
  }

  async buildWorkspace(ownerId, { scope = null } = {}) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    const [events, groupsWithMembers] = await Promise.all([
      this.financialEventRepository.findByOwnerId(ownerId),
      this.financialAccountGroupRepository
        ? this.financialAccountGroupRepository.findActiveGroupsForOwner(ownerId)
        : Promise.resolve([]),
    ]);

    const cutoverByAccountId = buildCutoverRuleByAccountId(groupsWithMembers);
    const eventsAfterCutover = cutoverByAccountId.size === 0
      ? events
      : events.filter((event) => !isExcludedByCutover(event, cutoverByAccountId));

    return this.aggregationService.aggregate(eventsAfterCutover, { scope });
  }

  // Slice 3 (load-times): dashboard-summary mode. Returns the SAME
  // portfolio/property/category totals as buildWorkspace, aggregated
  // inside PostgreSQL by forge_dashboard_financial_summary_v1 -- but NO
  // transaction rows. The returned workspace deliberately has NO
  // `transactions` key at all: a `transactions: []` here would read as
  // an empty COMPLETE history, which is false. Consumers that need the
  // list use the on-demand diagnostic endpoint instead, and the
  // transactionsStatus marker says so in plain terms. Scope semantics
  // match buildWorkspace (null = every business_scope).
  async buildDashboardSummary(ownerId, { scope = null } = {}) {
    if (!ownerId) {
      throw new Error("Owner id is required");
    }

    if (!this.dashboardFinancialSummaryRepository) {
      throw new Error(
        "Dashboard financial summary is unavailable.",
      );
    }

    const summary =
      await this.dashboardFinancialSummaryRepository.getSummary({
        ownerId,
        scope,
      });

    return Object.freeze({
      portfolio: summary.portfolio,
      properties: summary.properties,
      categories: summary.categories,
      transactionsStatus: "not-loaded",
      summaryVersion: summary.version,
      scope: summary.scope,
    });
  }
}

Object.freeze(FinancialWorkspaceQueryService);
