-- Extends approve_simplifi_csv_import to accept classification='personal' rows (previously only
-- 'safe_missing' business rows could ever be approved), so a landlord's non-business Simplifi
-- accounts can be imported for personal net-worth/cash-flow reporting per the same review, rather
-- than being silently dropped from history. Personal rows must never touch rental performance,
-- NOI, business profit, or tax totals, so financial_events.business_scope (added by
-- 20260824030000_add_financial_events_business_scope.sql) is derived here from the trusted
-- classification — never taken as-is from the client payload — and affects_noi/capitalized are
-- forced false whenever business_scope is 'personal', regardless of what the client computed.
--
-- This re-declares the whole function (same signature) rather than editing
-- 20260824000000_add_simplifi_csv_import.sql or 20260824020000_fix_simplifi_approval_security.sql
-- in place, since both are already-applied migrations; CREATE OR REPLACE FUNCTION must restate
-- every property those two migrations established (security definer, search_path, row_security
-- off) or it would silently revert to security invoker and break RLS-restricted writes.

create or replace function approve_simplifi_csv_import(
  p_owner_id text,
  p_file_hash text,
  p_safe_file_label text,
  p_preview_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_batch_id text;
  v_stored_preview_hash text;
  v_row jsonb;
  v_event_id text;
  v_inserted boolean;
  v_applied integer := 0;
  v_already_applied integer := 0;
  v_business_scope text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if p_owner_id is distinct from auth.uid()::text then raise exception 'Import owner does not match authenticated owner.'; end if;
  if p_file_hash !~ '^[0-9a-f]{64}$' or p_preview_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid file and preview hashes are required.';
  end if;
  if nullif(trim(p_safe_file_label), '') is null then raise exception 'A safe file label is required.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Approve between 1 and 500 Simplifi rows per batch.';
  end if;

  insert into simplifi_import_batches (
    owner_id, file_hash, safe_file_label, parser_version, row_count,
    preview_hash, status, created_by, approved_at
  ) values (
    p_owner_id, p_file_hash, left(p_safe_file_label, 200), 'v1', jsonb_array_length(p_rows),
    p_preview_hash, 'approved', p_owner_id, now()
  )
  on conflict (owner_id, file_hash, preview_hash) do nothing
  returning id, preview_hash into v_batch_id, v_stored_preview_hash;

  if v_batch_id is null then
    select id, preview_hash into v_batch_id, v_stored_preview_hash
    from simplifi_import_batches where owner_id = p_owner_id and file_hash = p_file_hash
      and preview_hash = p_preview_hash
    for update;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row->>'classification', '') not in ('safe_missing', 'personal') then
      raise exception 'Only freshly recomputed safe_missing or personal rows may be approved.';
    end if;
    if not exists (
      select 1 from financial_accounts a
      where a.owner_id = p_owner_id and a.id = v_row->>'financial_account_id' and a.active
    ) then raise exception 'A selected financial account is invalid.'; end if;
    if coalesce(v_row->>'fingerprint', '') !~ '^v1:[0-9a-f]{64}$'
      or coalesce(v_row->>'evidence_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(v_row->>'normalized_category', '') !~ '^[a-z0-9][a-z0-9_]{0,99}$'
      or coalesce(v_row->>'signed_amount_cents', '') !~ '^-?[0-9]+$'
      or coalesce(v_row->>'transaction_kind', '') not in ('income', 'expense', 'transfer', 'asset_purchase')
      or coalesce(v_row->>'affects_noi', '') not in ('true', 'false')
      or coalesce(v_row->>'capitalized', '') not in ('true', 'false')
    then raise exception 'Approved Simplifi row evidence is invalid.'; end if;

    v_business_scope := case when v_row->>'classification' = 'personal' then 'personal' else 'business' end;

    if exists (
      select 1
      from simplifi_import_rows existing
      where existing.owner_id = p_owner_id
        and existing.row_fingerprint = v_row->>'fingerprint'
        and (
          existing.evidence_hash is distinct from v_row->>'evidence_hash'
          or existing.financial_account_id is distinct from v_row->>'financial_account_id'
          or existing.event_date is distinct from (v_row->>'event_date')::date
          or existing.signed_amount_cents is distinct from (v_row->>'signed_amount_cents')::bigint
          or existing.normalized_category is distinct from v_row->>'normalized_category'
        )
    ) then
      raise exception 'Simplifi transaction was previously approved under different mapping or evidence.';
    end if;

    insert into financial_events (
      owner_id, financial_account_id, event_date, description, amount,
      transaction_kind, normalized_category, tax_deductible, affects_noi, capitalized,
      business_scope, source_system, source_record_id, metadata, created_by, updated_by
    ) values (
      p_owner_id,
      v_row->>'financial_account_id',
      (v_row->>'event_date')::date,
      left(coalesce(nullif(v_row->>'description', ''), 'Simplifi transaction'), 500),
      abs((v_row->>'signed_amount_cents')::bigint) / 100.0,
      v_row->>'transaction_kind',
      v_row->>'normalized_category',
      false,
      (v_business_scope = 'business') and (v_row->>'affects_noi')::boolean,
      (v_business_scope = 'business') and (v_row->>'capitalized')::boolean,
      v_business_scope,
      'quicken_simplifi_csv',
      v_row->>'fingerprint',
      jsonb_build_object(
        'batch_id', v_batch_id, 'evidence_hash', v_row->>'evidence_hash',
        'account_scope', v_row->>'account_scope', 'simplifi_category', v_row->>'simplifi_category'
      ),
      p_owner_id,
      p_owner_id
    )
    on conflict (owner_id, source_system, source_record_id) do nothing
    returning id into v_event_id;

    v_inserted := v_event_id is not null;
    if not v_inserted then
      v_already_applied := v_already_applied + 1;
      select id into v_event_id from financial_events
      where owner_id = p_owner_id and source_system = 'quicken_simplifi_csv'
        and source_record_id = v_row->>'fingerprint';
    else
      v_applied := v_applied + 1;
    end if;

    insert into simplifi_import_rows (
      owner_id, batch_id, row_fingerprint, fingerprint_version, evidence_hash,
      financial_account_id, event_date, signed_amount_cents, normalized_category,
      classification, approval_status, linked_financial_event_id
    ) values (
      p_owner_id, v_batch_id, v_row->>'fingerprint', 'v1', v_row->>'evidence_hash',
      v_row->>'financial_account_id', (v_row->>'event_date')::date,
      (v_row->>'signed_amount_cents')::bigint, v_row->>'normalized_category',
      v_row->>'classification', case when v_inserted then 'applied' else 'already_applied' end, v_event_id
    )
    on conflict (owner_id, batch_id, row_fingerprint) do update set
      approval_status = excluded.approval_status,
      linked_financial_event_id = excluded.linked_financial_event_id;
    v_event_id := null;
  end loop;

  return jsonb_build_object('batch_id', v_batch_id, 'applied', v_applied, 'already_applied', v_already_applied);
end;
$$;

revoke all on function approve_simplifi_csv_import(text,text,text,text,jsonb) from public;
grant execute on function approve_simplifi_csv_import(text,text,text,text,jsonb) to authenticated;
