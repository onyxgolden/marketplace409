-- Quicken Simplifi CSV import audit and mapping substrate.
-- Raw CSV bytes are never persisted. Approval is added separately and must recompute from
-- a byte-identical upload before writing financial_events.

create table if not exists simplifi_import_batches (
  id text primary key default ('simplifi_batch_' || gen_random_uuid()::text),
  owner_id text not null,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  safe_file_label text not null,
  parser_version text not null,
  row_count integer not null check (row_count >= 0),
  preview_hash text not null check (preview_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'previewed'
    check (status in ('previewed','approved','partially_approved','expired','rejected')),
  created_by text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (owner_id, file_hash, preview_hash)
);

create table if not exists simplifi_account_mappings (
  id text primary key default ('simplifi_mapping_' || gen_random_uuid()::text),
  owner_id text not null,
  simplifi_account_label text not null,
  normalized_label text not null,
  financial_account_id text not null,
  account_type text not null
    check (account_type in ('checking','savings','credit card','loan','cash','investment','other')),
  scope text not null check (scope in ('business','personal','mixed','excluded')),
  mapping_version integer not null default 1 check (mapping_version > 0),
  active boolean not null default true,
  effective_from date not null default current_date,
  effective_to date,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (financial_account_id) references financial_accounts(id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists idx_simplifi_mapping_active_label
  on simplifi_account_mappings(owner_id, normalized_label) where active;
create index if not exists idx_simplifi_mapping_owner_account
  on simplifi_account_mappings(owner_id, financial_account_id);

create table if not exists simplifi_import_rows (
  id text primary key default ('simplifi_row_' || gen_random_uuid()::text),
  owner_id text not null,
  batch_id text not null,
  row_fingerprint text not null,
  fingerprint_version text not null,
  evidence_hash text not null,
  financial_account_id text,
  event_date date not null,
  signed_amount_cents bigint not null,
  normalized_category text,
  classification text not null check (classification in (
    'safe_missing','already_imported','duplicate_in_file','overlap_rentec','overlap_plaid',
    'transfer_pair','card_payment_pair','refund_or_reversal','owner_contribution','owner_draw',
    'personal','pending','ambiguous','conflict','unsupported'
  )),
  approval_status text not null default 'not_selected'
    check (approval_status in ('not_selected','selected','applied','already_applied','rejected')),
  linked_financial_event_id text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  foreign key (batch_id) references simplifi_import_batches(id) on delete restrict,
  foreign key (financial_account_id) references financial_accounts(id) on delete restrict,
  foreign key (linked_financial_event_id) references financial_events(id) on delete restrict,
  unique (owner_id, batch_id, row_fingerprint)
);

create index if not exists idx_simplifi_rows_owner_batch
  on simplifi_import_rows(owner_id, batch_id);
create index if not exists idx_simplifi_rows_owner_classification
  on simplifi_import_rows(owner_id, classification);

alter table simplifi_import_batches enable row level security;
alter table simplifi_import_batches force row level security;
alter table simplifi_account_mappings enable row level security;
alter table simplifi_account_mappings force row level security;
alter table simplifi_import_rows enable row level security;
alter table simplifi_import_rows force row level security;

create policy simplifi_batches_owner_all on simplifi_import_batches for all to authenticated
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy simplifi_mappings_owner_all on simplifi_account_mappings for all to authenticated
  using (owner_id = auth.uid()::text) with check (
    owner_id = auth.uid()::text and exists (
      select 1 from financial_accounts a
      where a.id = financial_account_id and a.owner_id = auth.uid()::text
    )
  );
create policy simplifi_rows_owner_all on simplifi_import_rows for all to authenticated
  using (owner_id = auth.uid()::text) with check (
    owner_id = auth.uid()::text and exists (
      select 1 from financial_accounts a
      where a.id = financial_account_id and a.owner_id = auth.uid()::text
    )
  );

grant select, insert, update on simplifi_import_batches to authenticated;
grant select, insert, update on simplifi_account_mappings to authenticated;
grant select, insert, update on simplifi_import_rows to authenticated;

create or replace function approve_simplifi_csv_import(
  p_owner_id text,
  p_file_hash text,
  p_safe_file_label text,
  p_preview_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_id text;
  v_stored_preview_hash text;
  v_row jsonb;
  v_event_id text;
  v_inserted boolean;
  v_applied integer := 0;
  v_already_applied integer := 0;
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
    if coalesce(v_row->>'classification', '') <> 'safe_missing' then
      raise exception 'Only freshly recomputed safe_missing rows may be approved.';
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
      source_system, source_record_id, metadata, created_by, updated_by
    ) values (
      p_owner_id,
      v_row->>'financial_account_id',
      (v_row->>'event_date')::date,
      left(coalesce(nullif(v_row->>'description', ''), 'Simplifi transaction'), 500),
      abs((v_row->>'signed_amount_cents')::bigint) / 100.0,
      v_row->>'transaction_kind',
      v_row->>'normalized_category',
      false,
      (v_row->>'affects_noi')::boolean,
      (v_row->>'capitalized')::boolean,
      'quicken_simplifi_csv',
      v_row->>'fingerprint',
      jsonb_build_object('batch_id', v_batch_id, 'evidence_hash', v_row->>'evidence_hash'),
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
      'safe_missing', case when v_inserted then 'applied' else 'already_applied' end, v_event_id
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
