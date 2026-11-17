-- FORGE load-times Slice 3 — dashboard SQL aggregation.
--
-- The /forge initial dashboard used to transfer the owner's ENTIRE
-- financial-event history (select("*"), sequential 1,000-row pages) on
-- every load, once per dashboard builder (Slice 1 memoized the repeats
-- down to one scan, but the scan itself stayed). This migration adds ONE
-- read-only, SECURITY INVOKER RPC that aggregates the same history
-- inside PostgreSQL and returns bounded grouped results (portfolio,
-- per-property and per-category totals), so the initial dashboard path
-- never transfers transaction rows at all.
--
-- Deliberately NOT in this slice (see the Slice 3 scope brief):
--   * No date/lookback cap. All dates are covered, including pre-2020
--     events; a cap would silently change all-time KPIs.
--   * No cross-request cached read model. Every navigation recomputes
--     from committed rows, so a write followed by a dashboard request
--     always sees the post-write state with no invalidation to fail.
--   * No change to the legacy full-history repository
--     (SupabaseFinancialEventRepository.findByOwnerId). It remains the
--     detailed read for the on-demand diagnostic endpoint, the
--     Financial Transactions page and every other caller.
--
-- Parity contract (enforced by DashboardFinancialSummary.migration.test.js):
-- the RPC reproduces FinancialEventAggregationService.aggregate() exactly
-- over the same eligible set: same status/is_deleted/scope filtering,
-- same account-group transaction-authority cutover (half-open, date
-- >= cutover excluded for non-canonical members of reconciled groups
-- only; balance authority is NEVER substituted), same abs(amount) and
-- affects_noi NOI semantics, asset_purchase/transfer counted as
-- transactions but never as operating revenue/expenses/NOI/cash flow.
-- SQL numeric is exact-decimal while the JS oracle sums IEEE doubles;
-- the test compares displayed (cent-level) values with a documented
-- 0.01 tolerance, never by silently "fixing" financial numbers.
--
-- Indexes: no new index is added here. The eligible scan is served by
-- the existing idx_financial_events_owner / idx_financial_events_owner_
-- event_date indexes; the migration test runs EXPLAIN (ANALYZE, BUFFERS)
-- on a 2,501-event fixture to confirm the aggregation is DB-side and
-- the response is bounded by group cardinality, not event count.

create or replace function public.forge_dashboard_financial_summary_v1(
    p_owner_id text,
    p_scope text default 'business'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $func$
declare
  -- null scope means unfiltered (every business_scope), matching
  -- FinancialEventAggregationService's scope=null behavior.
  v_scope text := case when p_scope is null or p_scope = 'all' then null else p_scope end;
  v_bad_kind text;
  v_result jsonb;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.';
  end if;

  if p_scope is not null and p_scope not in ('business', 'personal', 'all') then
    raise exception 'Unsupported financial workspace scope: %', p_scope;
  end if;

  -- Explicit workspace guard. RLS on financial_events would also hide
  -- another owner's rows, but that would surface as silent zero totals,
  -- indistinguishable from a genuinely empty workspace -- deny loudly
  -- instead. has_workspace_access covers the owner and their active
  -- co-owners; it never equates auth.uid() with owner_id.
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'Not authorized for this workspace.';
  end if;

  -- The eligible set is defined ONCE, in the CTE below, and shared by
  -- the unknown-kind guard and all three aggregations, so the guard and
  -- the sums can never drift apart. Unknown kinds among eligible rows
  -- are a data error, never a silent exclusion: the JS aggregation
  -- service throws on the same input.
  with eligible as (
    select
      coalesce(nullif(e.property_id, ''), 'unassigned') as property_id,
      coalesce(nullif(e.normalized_category, ''), 'uncategorized') as category,
      abs(e.amount) as abs_amount,
      e.transaction_kind as transaction_kind,
      e.affects_noi as affects_noi
    from financial_events e
    where e.owner_id = p_owner_id
      and e.status not in ('inactive', 'deleted')
      and e.is_deleted is not true
      and (v_scope is null or e.business_scope = v_scope)
      -- Account-group transaction-authority cutover, mirroring
      -- FinancialWorkspaceQueryService.buildCutoverRuleByAccountId exactly:
      -- only groups with transaction_coverage_status='reconciled', an
      -- explicitly identified transaction authority AND a cutover date
      -- exclude anything, and only non-canonical members on/after the
      -- cutover date. Unreconciled groups, groups without authority or
      -- cutover, and the canonical member itself are never filtered.
      and not exists (
        select 1
        from financial_account_group_members m
        join financial_account_groups g on g.id = m.group_id
        where m.financial_account_id = e.financial_account_id
          and g.owner_id = p_owner_id
          and g.revoked_at is null
          and m.revoked_at is null
          and g.transaction_coverage_status = 'reconciled'
          and g.transaction_authority_account_id is not null
          and g.transaction_cutover_at is not null
          and m.financial_account_id <> g.transaction_authority_account_id
          and e.event_date >= g.transaction_cutover_at
      )
  ),
  bad_kind as (
    select min(transaction_kind) as kind
    from eligible
    where transaction_kind not in ('income', 'expense', 'asset_purchase', 'transfer')
  ),
  portfolio as (
    select
      coalesce(sum(case when transaction_kind = 'income' then abs_amount else 0 end), 0) as income,
      coalesce(sum(case when transaction_kind = 'expense' then abs_amount else 0 end), 0) as expenses,
      coalesce(sum(case
        when transaction_kind = 'income' and affects_noi then abs_amount
        when transaction_kind = 'expense' and affects_noi then -abs_amount
        else 0 end), 0) as noi,
      coalesce(sum(case
        when transaction_kind = 'income' then abs_amount
        when transaction_kind = 'expense' then -abs_amount
        else 0 end), 0) as cash_flow,
      count(*)::bigint as transaction_count
    from eligible
  ),
  properties as (
    select
      property_id,
      coalesce(sum(case when transaction_kind = 'income' then abs_amount else 0 end), 0) as income,
      coalesce(sum(case when transaction_kind = 'expense' then abs_amount else 0 end), 0) as expenses,
      coalesce(sum(case
        when transaction_kind = 'income' and affects_noi then abs_amount
        when transaction_kind = 'expense' and affects_noi then -abs_amount
        else 0 end), 0) as noi,
      coalesce(sum(case
        when transaction_kind = 'income' then abs_amount
        when transaction_kind = 'expense' then -abs_amount
        else 0 end), 0) as cash_flow,
      count(*)::bigint as transaction_count
    from eligible
    group by property_id
  ),
  categories as (
    select
      category,
      coalesce(sum(case when transaction_kind = 'income' then abs_amount else 0 end), 0) as income,
      coalesce(sum(case when transaction_kind = 'expense' then abs_amount else 0 end), 0) as expenses,
      coalesce(sum(case
        when transaction_kind = 'income' then abs_amount
        when transaction_kind = 'expense' then -abs_amount
        else 0 end), 0) as net_amount,
      count(*)::bigint as transaction_count
    from eligible
    group by category
  )
  select
    jsonb_build_object(
      'version', 'forge_dashboard_financial_summary_v1',
      'status', 'ok',
      'ownerId', p_owner_id,
      'scope', v_scope,
      'portfolio', jsonb_build_object(
        'income', p.income,
        'expenses', p.expenses,
        'noi', p.noi,
        'cashFlow', p.cash_flow,
        'transactionCount', p.transaction_count
      ),
      'properties', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'propertyId', pr.property_id,
            'income', pr.income,
            'expenses', pr.expenses,
            'noi', pr.noi,
            'cashFlow', pr.cash_flow,
            'transactionCount', pr.transaction_count
          ) order by pr.property_id)
         from properties pr),
        '[]'::jsonb
      ),
      'categories', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'category', c.category,
            'income', c.income,
            'expenses', c.expenses,
            'netAmount', c.net_amount,
            'transactionCount', c.transaction_count
          ) order by c.category)
         from categories c),
        '[]'::jsonb
      ),
      -- The initial dashboard deliberately ships NO transaction rows.
      -- Full history is available on demand through the dashboard
      -- diagnostic endpoint; this marker keeps an absent list honest
      -- instead of letting it read as an empty complete history.
      'transactionsStatus', 'not-loaded'
    ),
    (select kind from bad_kind)
  into v_result, v_bad_kind
  from portfolio p;

  if v_bad_kind is not null then
    raise exception 'Unsupported financial event transaction kind: %', v_bad_kind;
  end if;

  return v_result;
end;
$func$;

-- SECURITY INVOKER, authenticated role only. Revoke from each named role
-- explicitly: REVOKE ... FROM public is a no-op for function EXECUTE
-- under Supabase-style default privileges, so a public-only revoke
-- would leave anon with access.
revoke all on function public.forge_dashboard_financial_summary_v1(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.forge_dashboard_financial_summary_v1(text, text)
  to authenticated;
