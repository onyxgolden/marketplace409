-- FORGE load-times Slice 3 — diagnostic history, server-side pagination.
--
-- The on-demand diagnostic endpoint (GET /api/forge/dashboard/transactions)
-- used to rebuild the owner's ENTIRE financial-event history on EVERY page
-- request: the legacy repository fetched all 11,776 events in twelve
-- sequential 1,000-row PostgREST pages (OFFSET pagination whose cost grows
-- with depth -- EXPLAIN (ANALYZE) on production showed 76 ms for page 1
-- and 825 ms for page 12), then the JS aggregation service re-aggregated
-- the whole set, just to serve one 1,000-row page. That full rebuild per
-- page request exceeds the Vercel Hobby function time budget in
-- production: expanding the diagnostic layer failed deterministically
-- (500 "Unable to load transaction history." on the initial load and on
-- retry), while the same data path serves in 379 ms in the test harness
-- and the production data itself is clean (8,280 eligible events, no
-- null amounts/dates/ids, only the four known kinds).
--
-- This migration adds ONE read-only, SECURITY INVOKER RPC that serves a
-- single page from inside PostgreSQL: one round trip, one DB-side query
-- over the eligible set, no twelve-page fetch, no JS re-aggregation. It
-- reuses the summary RPC's eligible-set CTE verbatim (same status /
-- is_deleted / scope filtering, same account-group transaction-authority
-- cutover, same unknown-kind refusal), so the page it serves is the same
-- list the legacy path served -- same rows, same stable event_date,id
-- order, same record shape -- only fetched one page at a time.
--
-- Deliberately NOT in this fix (same as the Slice 3 scope brief):
--   * No date/lookback cap. All dates are covered, including pre-2020
--     events; a cap would silently change the history the diagnostic
--     layer promises ("all dates").
--   * No cross-request cached read model. Every page recomputes from
--     committed rows, so a write followed by a diagnostic request always
--     sees the post-write state with no invalidation to fail.
--   * No change to the legacy full-history repository
--     (SupabaseFinancialEventRepository.findByOwnerId) or to the summary
--     RPC (forge_dashboard_financial_summary_v1). Both stay as they are.
--
-- Parity contract (enforced by DashboardFinancialTransactions.migration.test.js):
-- the RPC reproduces FinancialEventAggregationService.aggregate()'s
-- transaction list exactly over the same eligible set: same filters, same
-- cutover, same abs(amount), same unassigned/uncategorized defaults, same
-- event_date,id order. SQL numeric is exact-decimal while the JS oracle
-- sums IEEE doubles; the test compares amounts at cent level, never by
-- silently "fixing" financial numbers.

create or replace function public.forge_dashboard_financial_transactions_v1(
    p_owner_id text,
    p_scope text default 'business',
    p_page integer default 1,
    p_page_size integer default 1000
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

  if p_page is null or p_page < 1 then
    raise exception 'Diagnostic page must be a positive integer.';
  end if;

  if p_page_size is null or p_page_size < 1 or p_page_size > 1000 then
    raise exception 'Diagnostic pageSize must be an integer between 1 and 1000.';
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
  -- the unknown-kind guard, the count and the page, so the guard, the
  -- totals and the rows can never drift apart. Unknown kinds among
  -- eligible rows are a data error, never a silent exclusion: the JS
  -- aggregation service throws on the same input.
  -- The eligible-set predicate is identical to
  -- forge_dashboard_financial_summary_v1's (same status/is_deleted/scope
  -- filtering, same account-group transaction-authority cutover):
  -- only groups with transaction_coverage_status='reconciled', an
  -- explicitly identified transaction authority AND a cutover date
  -- exclude anything, and only non-canonical members on/after the
  -- cutover date. Unreconciled groups, groups without authority or
  -- cutover, and the canonical member itself are never filtered.
  with eligible as (
    select
      e.id as id,
      coalesce(nullif(e.property_id, ''), 'unassigned') as property_id,
      e.event_date as event_date,
      e.description as description,
      abs(e.amount) as amount,
      e.transaction_kind as transaction_kind,
      coalesce(nullif(e.normalized_category, ''), 'uncategorized') as category,
      e.affects_noi as affects_noi,
      e.capitalized as capitalized,
      e.source_system as source_system,
      e.source_record_id as source_record_id,
      e.business_scope as business_scope,
      e.financial_account_id as financial_account_id
    from financial_events e
    where e.owner_id = p_owner_id
      and e.status not in ('inactive', 'deleted')
      and e.is_deleted is not true
      and (v_scope is null or e.business_scope = v_scope)
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
  counted as (
    select count(*)::bigint as total_count from eligible
  ),
  paged as (
    select *
    from eligible
    -- Stable order, identical to the JS aggregation service:
    -- event_date ascending, then id ascending.
    order by event_date asc, id asc
    limit p_page_size offset (p_page - 1) * p_page_size
  )
  select
    jsonb_build_object(
      'version', 'forge_dashboard_financial_transactions_v1',
      'status', 'ok',
      'ownerId', p_owner_id,
      'scope', v_scope,
      'page', p_page,
      'pageSize', p_page_size,
      'totalCount', c.total_count,
      'totalPages', greatest(1, ceil(c.total_count::numeric / p_page_size)::bigint),
      'complete', p_page >= greatest(1, ceil(c.total_count::numeric / p_page_size)::bigint),
      'transactions', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'id', p.id,
            'propertyId', p.property_id,
            'eventDate', p.event_date,
            'description', p.description,
            'amount', p.amount,
            'transactionKind', p.transaction_kind,
            'category', p.category,
            'affectsNOI', p.affects_noi,
            'capitalized', p.capitalized,
            'sourceSystem', p.source_system,
            'sourceRecordId', p.source_record_id,
            'businessScope', p.business_scope,
            'financialAccountId', p.financial_account_id
          ) order by p.event_date asc, p.id asc)
         from paged p),
        '[]'::jsonb
      ),
      'transactionsStatus', 'loaded'
    ),
    (select kind from bad_kind)
  into v_result, v_bad_kind
  from counted c;

  -- A page past the end is NOT raised here: the RPC returns the empty
  -- page with the correct counts, and the repository enforces the
  -- 400 (a page past the end is a client error, never a silent empty
  -- page) -- the RPC's PostgREST error carries no HTTP status, so a
  -- raise here would surface as a 500 instead of the 400 the route
  -- has always returned for a nonexistent page.
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
revoke all on function public.forge_dashboard_financial_transactions_v1(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.forge_dashboard_financial_transactions_v1(text, text, integer, integer)
  to authenticated;
