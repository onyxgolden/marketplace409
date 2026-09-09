import {
  financialEventAggregationService,
} from "../../domains/financial-workspace/index.js";

// Half-open interval, no overlap, no gap, applied ONLY for a group whose
// transaction_coverage_status is 'reconciled' and whose transaction_cutover_at has been
// explicitly set (both require a human confirmation -- see
// advance_financial_account_group_coverage_status/set_financial_account_group_transaction_
// cutover). transaction_cutover_at is a plain SQL date, and financial_events.event_date is
// stored the same way -- both write paths (Stripe's transactedAt truncation and the Simplifi CSV
// parser) were confirmed to already be UTC-anchored, independent of server timezone, so this
// string comparison needs no timezone conversion of its own.
//
// The canonical/live side of a group is treated as balanceAuthorityAccountId -- for the group
// shapes this table actually supports today (one live connection reconciled against one static
// manual/CSV representation), the account that's authoritative for the CURRENT balance is the
// same one whose ongoing transaction history takes over at cutover. A future group with more
// than one live member reconciling transactions independently of its balance authority would
// need its own explicit field; not needed by anything this PR builds toward.
function buildCutoverRuleByAccountId(groupsWithMembers) {
  const cutoverByAccountId = new Map();

  for (const { group, activeMemberFinancialAccountIds } of groupsWithMembers) {
    if (group.transactionCoverageStatus !== "reconciled" || !group.transactionCutoverAt) {
      continue;
    }

    for (const financialAccountId of activeMemberFinancialAccountIds) {
      cutoverByAccountId.set(financialAccountId, {
        isCanonical: financialAccountId === group.balanceAuthorityAccountId,
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

    this.financialEventRepository = financialEventRepository;
    this.aggregationService = aggregationService;
    this.financialAccountGroupRepository = financialAccountGroupRepository;

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
}

Object.freeze(FinancialWorkspaceQueryService);
