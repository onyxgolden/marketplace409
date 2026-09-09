import { NetWorthService } from "../networth/networth.service";

export const ASSET_ACCOUNT_TYPES = Object.freeze(
  new Set(["depository", "investment", "other"]),
);

export const LIABILITY_ACCOUNT_TYPES = Object.freeze(
  new Set(["credit", "loan"]),
);

// A "static" representation (manual entry or a bulk CSV import) never counts as more
// authoritative than a live, connected provider -- Stripe and Plaid are deliberately given EQUAL
// standing here (neither name is ever checked); only whether a provider is a live connection at
// all, then freshness, ever decides between two group members. See
// resolveGroupBalanceAuthority below and its own header comment for the full rule.
const STATIC_PROVIDER_PATTERN = /(^manual$|_csv$)/;

// Named per the explicitly approved staleness policy: a warning at 48 hours (the balance stays
// authoritative, but the read model flags it so the UI stops presenting it as unambiguously
// fresh), a hard disqualification at 7 days (the group's balance authority falls back to the
// next-best live member, or to the freshest static member if none remain).
const BALANCE_STALENESS_WARNING_HOURS = 48;
const MAX_BALANCE_STALENESS_DAYS = 7;

function freezeItems(items) {
  return Object.freeze(
    items.map((item) => Object.freeze({ ...item })),
  );
}

function centsToDollars(cents) {
  return Number(cents) / 100;
}

function buildBalanceByAccountId(accountBalances) {
  return new Map(
    accountBalances.map((balance) => [
      balance.financialAccountId,
      balance,
    ]),
  );
}

function isStaticProvider(provider) {
  return STATIC_PROVIDER_PATTERN.test(provider || "");
}

function hoursSince(isoTimestamp, now) {
  return (now.getTime() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60);
}

function pickFreshest(candidates) {
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => {
    const diff = new Date(b.balance.asOf).getTime() - new Date(a.balance.asOf).getTime();
    return diff !== 0 ? diff : a.account.id.localeCompare(b.account.id);
  })[0];
}

// Resolves, for ONE group, which active member's balance is currently authoritative -- purely
// from health/freshness, never a hardcoded provider name (satisfies "Stripe and Plaid have
// equal provider authority; freshness and health determine precedence between two connected
// providers"). Live (connected) members always outrank static (manual/CSV) ones -- this is the
// "a live connection is never defeated by a stale timestamp on a static representation" rule.
// Among live members, freshest as_of wins; a live member whose as_of exceeds
// MAX_BALANCE_STALENESS_DAYS is disqualified entirely and falls back to the next-best live
// member, or to the freshest static member if none remain eligible (the "disconnected/degraded
// provider fallback" case). A selected live member whose as_of exceeds
// BALANCE_STALENESS_WARNING_HOURS but not the 7-day hard limit is still selected, but flagged
// degraded, exactly as required: a 48-hour-old balance is never presented as unambiguously fresh
// just because nothing has disqualified it yet.
function resolveGroupBalanceAuthority(memberFinancialAccountIds, financialAccountsById, balanceByAccountId, now) {
  const candidates = memberFinancialAccountIds
    .map((id) => ({ account: financialAccountsById.get(id), balance: balanceByAccountId.get(id) }))
    .filter((candidate) => candidate.account && candidate.balance);

  if (candidates.length === 0) return null;

  const live = candidates.filter((candidate) => !isStaticProvider(candidate.account.provider));
  const eligibleLive = live.filter((candidate) => hoursSince(candidate.balance.asOf, now) <= MAX_BALANCE_STALENESS_DAYS * 24);
  const staticCandidates = candidates.filter((candidate) => isStaticProvider(candidate.account.provider));

  const winner = pickFreshest(eligibleLive) || pickFreshest(staticCandidates);
  if (!winner) return null;

  const winnerIsStatic = isStaticProvider(winner.account.provider);
  const ageHours = hoursSince(winner.balance.asOf, now);

  return {
    winnerAccountId: winner.account.id,
    // A static winner is ALWAYS labeled "last known / manual" and degraded, whether it won
    // because it's the group's only member or because every live member was disqualified --
    // never rendered identically to a live, current balance.
    degraded: winnerIsStatic || ageHours > BALANCE_STALENESS_WARNING_HOURS,
    sourceLabel: winnerIsStatic ? "last known / manual" : ageHours > BALANCE_STALENESS_WARNING_HOURS ? "stale" : "current",
    supersededAccountIds: candidates
      .filter((candidate) => candidate.account.id !== winner.account.id)
      .map((candidate) => candidate.account.id),
  };
}

// Builds financialAccountId -> resolution for every account that belongs to an active group.
// Ungrouped accounts (the overwhelming majority today) never appear in this map at all, and are
// projected exactly as before -- this is purely additive behavior for grouped accounts.
function buildAuthorityByAccountId(groupsWithMembers, financialAccountsById, balanceByAccountId, now) {
  const authorityByAccountId = new Map();

  for (const { activeMemberFinancialAccountIds } of groupsWithMembers) {
    const resolution = resolveGroupBalanceAuthority(activeMemberFinancialAccountIds, financialAccountsById, balanceByAccountId, now);
    if (!resolution) continue;

    for (const accountId of activeMemberFinancialAccountIds) {
      authorityByAccountId.set(accountId, {
        isWinner: accountId === resolution.winnerAccountId,
        degraded: resolution.degraded,
        sourceLabel: resolution.sourceLabel,
      });
    }
  }

  return authorityByAccountId;
}

function projectAssets(financialAccounts, balanceByAccountId, authorityByAccountId, supersededBalances) {
  return financialAccounts
    .filter((account) => account.active !== false && ASSET_ACCOUNT_TYPES.has(account.type))
    .flatMap((account) => {
      const balance = balanceByAccountId.get(account.id);

      if (!balance) {
        return [];
      }

      const authority = authorityByAccountId.get(account.id);
      // A grouped account that lost the authority resolution is excluded from the aggregate
      // entirely -- its balance is recorded in supersededBalances instead, with full provenance,
      // never silently dropped.
      if (authority && !authority.isWinner) {
        supersededBalances.push({
          id: account.id,
          name: account.name,
          provider: account.provider,
          current_value: centsToDollars(balance.currentBalanceCents),
          as_of: balance.asOf,
        });
        return [];
      }

      return [{
        id: account.id,
        name: account.name,
        category: account.subtype || account.type,
        account_type: account.type,
        current_value: centsToDollars(
          balance.currentBalanceCents,
        ),
        // Only present at all for a grouped account -- an ungrouped account's shape is byte-for-
        // byte identical to before this feature existed.
        ...(authority ? { degraded: authority.degraded, source_label: authority.sourceLabel } : {}),
      }];
    });
}

function projectLiabilities(
  financialAccounts,
  balanceByAccountId,
  authorityByAccountId,
  supersededBalances,
) {
  return financialAccounts
    .filter((account) =>
      account.active !== false && LIABILITY_ACCOUNT_TYPES.has(account.type),
    )
    .flatMap((account) => {
      const balance = balanceByAccountId.get(account.id);

      if (!balance) {
        return [];
      }

      const authority = authorityByAccountId.get(account.id);
      if (authority && !authority.isWinner) {
        supersededBalances.push({
          id: account.id,
          name: account.name,
          provider: account.provider,
          current_balance: centsToDollars(balance.currentBalanceCents),
          as_of: balance.asOf,
        });
        return [];
      }

      return [{
        id: account.id,
        name: account.name,
        category: account.subtype || account.type,
        current_balance: centsToDollars(
          balance.currentBalanceCents,
        ),
        ...(authority ? { degraded: authority.degraded, source_label: authority.sourceLabel } : {}),
      }];
    });
}

function mapAssetsForNetWorth(assets) {
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    category: asset.category,
    value: Number(asset.current_value),
  }));
}

function mapLiabilitiesForNetWorth(liabilities) {
  return liabilities.map((liability) => ({
    id: liability.id,
    name: liability.name,
    category: liability.category,
    balance: Number(liability.current_balance),
  }));
}

export class FinancialPositionQueryService {
  constructor({
    financialAccountRepository,
    accountBalanceRepository,
    // Optional, deliberately -- every existing caller/test that never had a reason to know about
    // groups keeps working completely unchanged; grouping only ever narrows/relabels the result
    // for accounts that have been explicitly, manually grouped, never for anything else.
    financialAccountGroupRepository = null,
    netWorthService = NetWorthService,
    now = () => new Date(),
  } = {}) {
    if (
      !financialAccountRepository ||
      typeof financialAccountRepository.findByOwnerId !==
        "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires a financial account repository.",
      );
    }

    if (
      !accountBalanceRepository ||
      typeof accountBalanceRepository.findLatestByOwnerId !==
        "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires an account balance repository.",
      );
    }

    if (
      !netWorthService ||
      typeof netWorthService.calculate !== "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires a net worth service.",
      );
    }

    this.financialAccountRepository =
      financialAccountRepository;
    this.accountBalanceRepository =
      accountBalanceRepository;
    this.financialAccountGroupRepository =
      financialAccountGroupRepository;
    this.netWorthService = netWorthService;
    this.now = now;

    Object.freeze(this);
  }

  async buildPosition(ownerId) {
    if (!ownerId) {
      throw new Error(
        "FinancialPositionQueryService requires an owner id.",
      );
    }

    const [financialAccounts, accountBalances, groupsWithMembers] =
      await Promise.all([
        this.financialAccountRepository.findByOwnerId(
          ownerId,
        ),
        this.accountBalanceRepository.findLatestByOwnerId(
          ownerId,
        ),
        this.financialAccountGroupRepository
          ? this.financialAccountGroupRepository.findActiveGroupsForOwner(ownerId)
          : Promise.resolve([]),
      ]);

    const immutableAccountBalances =
      freezeItems(accountBalances);

    const balanceByAccountId =
      buildBalanceByAccountId(
        immutableAccountBalances,
      );

    const financialAccountsById = new Map(
      financialAccounts.map((account) => [account.id, account]),
    );

    const authorityByAccountId = buildAuthorityByAccountId(
      groupsWithMembers,
      financialAccountsById,
      balanceByAccountId,
      this.now(),
    );

    const supersededBalances = [];

    const immutableAssets = freezeItems(
      projectAssets(
        financialAccounts,
        balanceByAccountId,
        authorityByAccountId,
        supersededBalances,
      ),
    );

    const immutableLiabilities = freezeItems(
      projectLiabilities(
        financialAccounts,
        balanceByAccountId,
        authorityByAccountId,
        supersededBalances,
      ),
    );

    const netWorth = Object.freeze(
      this.netWorthService.calculate(
        mapAssetsForNetWorth(immutableAssets),
        mapLiabilitiesForNetWorth(
          immutableLiabilities,
        ),
      ),
    );

    return Object.freeze({
      assets: immutableAssets,
      liabilities: immutableLiabilities,
      accountBalances: immutableAccountBalances,
      supersededBalances: freezeItems(supersededBalances),
      netWorth,
      metrics: null,
      insights: Object.freeze([]),
      metadata: Object.freeze({
        accountBalancesStatus: "repository-backed",
        metricsStatus:
          "unavailable-without-canonical-ledger-position",
        insightsStatus:
          "unavailable-without-financial-metrics",
      }),
    });
  }
}

Object.freeze(FinancialPositionQueryService);
