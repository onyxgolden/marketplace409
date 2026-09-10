import { supabase as defaultSupabase } from "@/lib/supabase";

function mapGroupRow(row) {
  return Object.freeze({
    id: row.id,
    ownerId: row.owner_id,
    relationship: row.relationship,
    balanceAuthorityAccountId: row.balance_authority_account_id,
    transactionAuthorityAccountId: row.transaction_authority_account_id,
    transactionCoverageStatus: row.transaction_coverage_status,
    transactionCoverageVerifiedByUserId: row.transaction_coverage_verified_by_user_id,
    transactionCoverageVerifiedAt: row.transaction_coverage_verified_at,
    transactionCutoverAt: row.transaction_cutover_at,
    transactionCutoverTimezone: row.transaction_cutover_timezone,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    note: row.note,
  });
}

function mapMemberRow(row) {
  return Object.freeze({
    id: row.id,
    groupId: row.group_id,
    financialAccountId: row.financial_account_id,
    ownerId: row.owner_id,
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedAt: row.confirmed_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
  });
}

// Every read here is plain SELECT-only, covered by the has_workspace_access RLS policy on both
// tables -- this repository must always be constructed with an AUTHENTICATED (cookie-bound)
// Supabase client, never a service-role one, for both reads (RLS-scoped) and writes (the RPCs
// derive owner_id/actor from auth.uid() via resolve_effective_owner_id(), which requires a real
// authenticated session to resolve to anything meaningful).
export class SupabaseFinancialAccountGroupRepository {
  constructor(options = {}) {
    this.supabase = options.supabaseClient || defaultSupabase;
  }

  // Returns every active (non-revoked) group + its active member account ids, for every group
  // this owner can see. Two queries (groups, then members for those group ids) rather than a
  // single joined query, since the JS client's query builder does not need a hand-written join
  // for a shape this simple, and RLS applies identically either way.
  async findActiveGroupsForOwner(ownerId) {
    const { data: groupRows, error: groupError } = await this.supabase
      .from("financial_account_groups")
      .select("*")
      .eq("owner_id", ownerId)
      .is("revoked_at", null);
    if (groupError) throw groupError;

    if (!groupRows || groupRows.length === 0) {
      return Object.freeze([]);
    }

    const groupIds = groupRows.map((row) => row.id);
    const { data: memberRows, error: memberError } = await this.supabase
      .from("financial_account_group_members")
      .select("*")
      .in("group_id", groupIds)
      .is("revoked_at", null);
    if (memberError) throw memberError;

    const memberIdsByGroupId = new Map();
    for (const memberRow of memberRows || []) {
      const list = memberIdsByGroupId.get(memberRow.group_id) || [];
      list.push(memberRow.financial_account_id);
      memberIdsByGroupId.set(memberRow.group_id, list);
    }

    return Object.freeze(
      groupRows.map((groupRow) =>
        Object.freeze({
          group: mapGroupRow(groupRow),
          activeMemberFinancialAccountIds: Object.freeze(memberIdsByGroupId.get(groupRow.id) || []),
        }),
      ),
    );
  }

  async createGroup({ canonicalFinancialAccountId, note = null }) {
    const { data, error } = await this.supabase.rpc("create_financial_account_group", {
      p_canonical_financial_account_id: canonicalFinancialAccountId,
      p_note: note,
    });
    if (error) throw error;
    return mapGroupRow(Array.isArray(data) ? data[0] : data);
  }

  async addMember({ groupId, financialAccountId }) {
    const { data, error } = await this.supabase.rpc("add_financial_account_group_member", {
      p_group_id: groupId,
      p_financial_account_id: financialAccountId,
    });
    if (error) throw error;
    return mapMemberRow(Array.isArray(data) ? data[0] : data);
  }

  async revokeMember({ memberId }) {
    const { error } = await this.supabase.rpc("revoke_financial_account_group_member", {
      p_member_id: memberId,
    });
    if (error) throw error;
  }

  async revokeGroup({ groupId }) {
    const { error } = await this.supabase.rpc("revoke_financial_account_group", {
      p_group_id: groupId,
    });
    if (error) throw error;
  }

  async setBalanceAuthority({ groupId, financialAccountId }) {
    const { data, error } = await this.supabase.rpc("set_financial_account_group_balance_authority", {
      p_group_id: groupId,
      p_financial_account_id: financialAccountId,
    });
    if (error) throw error;
    return mapGroupRow(Array.isArray(data) ? data[0] : data);
  }

  async setTransactionAuthority({ groupId, financialAccountId }) {
    const { data, error } = await this.supabase.rpc("set_financial_account_group_transaction_authority", {
      p_group_id: groupId,
      p_financial_account_id: financialAccountId,
    });
    if (error) throw error;
    return mapGroupRow(Array.isArray(data) ? data[0] : data);
  }

  async advanceCoverageStatus({ groupId, newStatus, note = null }) {
    const { data, error } = await this.supabase.rpc("advance_financial_account_group_coverage_status", {
      p_group_id: groupId,
      p_new_status: newStatus,
      p_note: note,
    });
    if (error) throw error;
    return mapGroupRow(Array.isArray(data) ? data[0] : data);
  }

  async setTransactionCutover({ groupId, cutoverDate }) {
    const { data, error } = await this.supabase.rpc("set_financial_account_group_transaction_cutover", {
      p_group_id: groupId,
      p_cutover_date: cutoverDate,
    });
    if (error) throw error;
    return mapGroupRow(Array.isArray(data) ? data[0] : data);
  }
}

Object.freeze(SupabaseFinancialAccountGroupRepository);
