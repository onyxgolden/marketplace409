-- Private FORGE Health household tracker.
-- Access is intentionally independent from general FORGE workspace access. The bootstrap RPC
-- copies only the primary owner and the single active co-owner that exist at setup time into an
-- explicit allowlist; later business-workspace members receive no health access automatically.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('health-documents','health-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.health_workspaces (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id),
  name text not null default 'Our health',
  created_at timestamptz not null default now()
);

create table public.health_workspace_members (
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'partner')),
  added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create unique index health_workspace_one_per_user
  on public.health_workspace_members(user_id);

create table public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  profile_type text not null check (profile_type in ('member', 'managed_dependent')) default 'member',
  relationship text,
  managed_by uuid references auth.users(id) on delete set null,
  date_of_birth date,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, auth_user_id)
);

create table public.health_conditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  name text not null,
  diagnosed_on date,
  status text not null check (status in ('active', 'monitoring', 'resolved', 'historical')) default 'active',
  diagnosed_by text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_care_team (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  clinician_name text not null,
  specialty text,
  organization text,
  phone text,
  first_seen_on date,
  last_seen_on date,
  relationship_status text not null check (relationship_status in ('current', 'former', 'prospective')) default 'current',
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_provider_insurance_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  care_team_id uuid references public.health_care_team(id) on delete set null,
  insurer_name text not null,
  plan_name text,
  acceptance_status text not null check (acceptance_status in ('accepted', 'not_accepted', 'pending', 'unknown')),
  effective_on date not null,
  ended_on date,
  reason text,
  verified_with text,
  verified_at timestamptz,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= effective_on)
);

create table public.health_record_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  provider_name text not null,
  requested_on date not null,
  date_range_start date,
  date_range_end date,
  delivery_format text,
  delivery_destination text,
  authorization_type text check (authorization_type in ('patient_signed', 'personal_representative', 'portal_proxy', 'other')),
  status text not null check (status in ('draft', 'submitted', 'partial', 'received', 'denied', 'follow_up')) default 'draft',
  due_on date,
  received_on date,
  fee_cents integer check (fee_cents is null or fee_cents >= 0),
  confirmation_reference text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  authorization_type text not null check (authorization_type in ('medical_power_of_attorney', 'hipaa_release', 'portal_proxy', 'guardianship', 'other')),
  representative_name text not null,
  effective_on date,
  expires_on date,
  status text not null check (status in ('active', 'expired', 'revoked', 'pending_verification')) default 'active',
  scope_summary text,
  secure_document_reference text,
  original_location text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_on is null or effective_on is null or expires_on >= effective_on)
);

create table public.health_authorization_verifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  authorization_id uuid not null references public.health_authorizations(id) on delete cascade,
  provider_name text not null,
  verified_on date not null,
  verified_by text,
  confirmation_reference text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  category text not null check (category in ('medication_label','lab_report','visit_summary','imaging','prescription','insurance','authorization','other')),
  title text not null,
  document_date date,
  bucket text not null default 'health-documents' check (bucket = 'health-documents'),
  object_path text not null,
  original_filename text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  extraction_method text check (extraction_method in ('native_pdf','google_cloud_vision','pending','failed')),
  extracted_text text,
  review_status text not null check (review_status in ('pending_review','confirmed','rejected','extraction_failed')) default 'pending_review',
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(bucket,object_path)
);

create table public.health_extraction_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  document_id uuid not null references public.health_documents(id) on delete cascade,
  proposal_type text not null check (proposal_type in ('regimen_item','lab_results','profile','care_team','record_request','unclassified')),
  proposed_data jsonb not null,
  parser_version text not null,
  status text not null check (status in ('pending_review','confirmed','rejected')) default 'pending_review',
  reviewed_data jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(proposed_data) = 'object'),
  check (status = 'pending_review' or (reviewed_by is not null and reviewed_at is not null))
);

create table public.health_lab_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  collected_on date not null,
  panel_name text,
  marker_name text not null,
  value_numeric numeric,
  value_text text,
  unit text,
  reference_low numeric,
  reference_high numeric,
  reference_text text,
  flag text check (flag in ('low', 'normal', 'high', 'critical', 'unknown')) default 'unknown',
  source_name text,
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (value_numeric is not null or nullif(btrim(value_text), '') is not null)
);

create index health_lab_results_profile_marker_date
  on public.health_lab_results(profile_id, marker_name, collected_on desc);

create table public.health_regimen_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  category text not null check (category in ('prescription', 'supplement', 'peptide', 'other')),
  name text not null,
  dose text,
  route text,
  frequency text,
  started_on date,
  ended_on date,
  status text not null check (status in ('planned', 'active', 'paused', 'stopped')) default 'active',
  prescribed_by text,
  purpose text,
  condition_id uuid references public.health_conditions(id) on delete set null,
  schedule_type text not null check (schedule_type in ('scheduled', 'as_needed', 'cycle')) default 'scheduled',
  instructions text,
  pharmacy text,
  prescription_number text,
  refills_remaining integer check (refills_remaining is null or refills_remaining >= 0),
  next_refill_on date,
  notes text,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

create table public.health_regimen_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  regimen_item_id uuid references public.health_regimen_items(id) on delete set null,
  occurred_at timestamptz not null,
  event_type text not null check (event_type in ('taken', 'injected', 'missed', 'misfire', 'skipped', 'side_effect', 'note')),
  dose text,
  injection_site text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_measurements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  measured_at timestamptz not null,
  measurement_type text not null,
  value_numeric numeric not null,
  secondary_value_numeric numeric,
  unit text not null,
  context text,
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index health_measurements_profile_type_date
  on public.health_measurements(profile_id, measurement_type, measured_at desc);

create table public.health_workouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  performed_at timestamptz not null,
  workout_type text not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  details jsonb not null default '[]'::jsonb,
  perceived_exertion smallint check (perceived_exertion between 1 and 10),
  notes text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(details) = 'array')
);

create table public.health_clinical_timeline (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid not null references public.health_profiles(id) on delete cascade,
  occurred_on date not null,
  event_type text not null check (event_type in ('visit', 'recommendation', 'diagnosis', 'regimen_change', 'insurance', 'document', 'note')),
  title text not null,
  details text,
  source_reference text,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.health_audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.health_workspaces(id) on delete cascade,
  profile_id uuid,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid not null references auth.users(id),
  old_record jsonb,
  new_record jsonb,
  occurred_at timestamptz not null default now()
);

create index health_audit_log_workspace_date on public.health_audit_log(workspace_id, occurred_at desc);

create or replace function public.confirm_health_extraction_proposal(
  p_proposal_id uuid,
  p_reviewed_data jsonb
)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_proposal public.health_extraction_proposals%rowtype;
  v_result jsonb;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'Authentication is required'; end if;
  if jsonb_typeof(p_reviewed_data) <> 'object' then raise exception 'Reviewed data must be an object'; end if;

  select * into v_proposal
  from public.health_extraction_proposals
  where id = p_proposal_id
  for update;

  if not found or not exists (
    select 1 from public.health_workspace_members
    where workspace_id = v_proposal.workspace_id and user_id = v_actor
  ) then
    raise exception 'Health extraction proposal was not found';
  end if;
  if v_proposal.status <> 'pending_review' then raise exception 'This proposal has already been reviewed'; end if;

  if v_proposal.proposal_type = 'regimen_item' then
    if nullif(btrim(p_reviewed_data->>'name'), '') is null then raise exception 'Medication or supplement name is required'; end if;
    if coalesce(p_reviewed_data->>'category', 'prescription') not in ('prescription','supplement','peptide','other') then raise exception 'Invalid regimen category'; end if;

    insert into public.health_regimen_items (
      workspace_id, profile_id, category, name, dose, route, frequency, started_on,
      instructions, refills_remaining, status, created_by, updated_by
    ) values (
      v_proposal.workspace_id, v_proposal.profile_id,
      coalesce(p_reviewed_data->>'category', 'prescription'), btrim(p_reviewed_data->>'name'),
      nullif(btrim(p_reviewed_data->>'dose'), ''), nullif(btrim(p_reviewed_data->>'route'), ''),
      nullif(btrim(p_reviewed_data->>'frequency'), ''), nullif(p_reviewed_data->>'startedOn', '')::date,
      nullif(btrim(p_reviewed_data->>'instructions'), ''), nullif(p_reviewed_data->>'refillsRemaining', '')::integer,
      'active', v_actor, v_actor
    ) returning jsonb_build_object('recordType','regimen_item','id',id) into v_result;
  elsif v_proposal.proposal_type = 'lab_results' then
    if nullif(p_reviewed_data->>'collectedOn', '') is null then raise exception 'Collection date is required'; end if;
    if jsonb_typeof(p_reviewed_data->'results') <> 'array' or jsonb_array_length(p_reviewed_data->'results') = 0 then
      raise exception 'At least one laboratory result is required';
    end if;

    insert into public.health_lab_results (
      workspace_id, profile_id, collected_on, panel_name, marker_name, value_numeric, value_text,
      unit, reference_low, reference_high, reference_text, flag, source_name, notes, created_by
    )
    select
      v_proposal.workspace_id, v_proposal.profile_id, (p_reviewed_data->>'collectedOn')::date,
      nullif(btrim(p_reviewed_data->>'panelName'), ''), btrim(item->>'markerName'),
      nullif(item->>'valueNumeric', '')::numeric, nullif(btrim(item->>'valueText'), ''),
      nullif(btrim(item->>'unit'), ''), nullif(item->>'referenceLow', '')::numeric,
      nullif(item->>'referenceHigh', '')::numeric, nullif(btrim(item->>'referenceText'), ''),
      case when item->>'flag' in ('low','normal','high','critical','unknown') then item->>'flag' else 'unknown' end,
      nullif(btrim(p_reviewed_data->>'sourceName'), ''), nullif(btrim(item->>'notes'), ''), v_actor
    from jsonb_array_elements(p_reviewed_data->'results') item
    where nullif(btrim(item->>'markerName'), '') is not null
      and (nullif(item->>'valueNumeric', '') is not null or nullif(btrim(item->>'valueText'), '') is not null);
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'No complete laboratory results were provided'; end if;
    v_result := jsonb_build_object('recordType','lab_results','createdCount',v_count);
  else
    raise exception 'This document type requires manual entry';
  end if;

  update public.health_extraction_proposals
  set status = 'confirmed', reviewed_data = p_reviewed_data, reviewed_by = v_actor, reviewed_at = now()
  where id = p_proposal_id;
  update public.health_documents set review_status = 'confirmed' where id = v_proposal.document_id;
  return v_result;
end;
$$;

revoke all on function public.confirm_health_extraction_proposal(uuid,jsonb) from public;
grant execute on function public.confirm_health_extraction_proposal(uuid,jsonb) to authenticated;

create or replace function public.health_has_workspace_access(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.health_workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

revoke all on function public.health_has_workspace_access(uuid) from public;
grant execute on function public.health_has_workspace_access(uuid) to authenticated;

create or replace function public.bootstrap_private_health_workspace()
returns uuid language plpgsql security definer set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_workspace uuid;
  v_partner uuid;
  v_owner_name text;
  v_partner_name text;
begin
  if v_actor is null then raise exception 'Authentication is required.'; end if;

  select workspace_id into v_workspace
  from public.health_workspace_members where user_id = v_actor;
  if v_workspace is not null then return v_workspace; end if;

  -- Setup is owner-only. A co-owner cannot create a second household around the same FORGE owner.
  if exists (select 1 from public.workspace_members where member_user_id = v_actor and status = 'active') then
    raise exception 'The primary owner must initialize the private health workspace.';
  end if;

  select wm.member_user_id into v_partner
  from public.workspace_members wm
  where wm.owner_id = v_actor::text and wm.role = 'co_owner' and wm.status = 'active'
  order by wm.activated_at nulls last limit 1;
  if v_partner is null then raise exception 'An active co-owner is required before health setup.'; end if;

  select coalesce(nullif(raw_user_meta_data->>'full_name',''), nullif(raw_user_meta_data->>'name',''), email, 'Primary profile')
    into v_owner_name from auth.users where id = v_actor;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''), nullif(raw_user_meta_data->>'name',''), email, 'Partner profile')
    into v_partner_name from auth.users where id = v_partner;

  insert into public.health_workspaces(created_by) values (v_actor) returning id into v_workspace;
  insert into public.health_workspace_members(workspace_id,user_id,role,added_by)
    values (v_workspace,v_actor,'owner',v_actor),(v_workspace,v_partner,'partner',v_actor);
  insert into public.health_profiles(workspace_id,auth_user_id,display_name,created_by)
    values (v_workspace,v_actor,v_owner_name,v_actor),(v_workspace,v_partner,v_partner_name,v_actor);
  return v_workspace;
end;
$$;

revoke all on function public.bootstrap_private_health_workspace() from public;
grant execute on function public.bootstrap_private_health_workspace() to authenticated;

create or replace function public.add_health_managed_dependent(
  p_workspace_id uuid, p_display_name text, p_relationship text, p_date_of_birth date default null
) returns public.health_profiles language plpgsql security invoker set search_path = public
as $$
declare v_profile public.health_profiles;
begin
  if not public.health_has_workspace_access(p_workspace_id) then raise exception 'Health workspace access is required.'; end if;
  if nullif(btrim(p_display_name),'') is null then raise exception 'Dependent name is required.'; end if;
  insert into public.health_profiles(workspace_id,display_name,profile_type,relationship,managed_by,date_of_birth,created_by)
  values(p_workspace_id,btrim(p_display_name),'managed_dependent',nullif(btrim(p_relationship),''),auth.uid(),p_date_of_birth,auth.uid())
  returning * into v_profile;
  return v_profile;
end;
$$;

revoke all on function public.add_health_managed_dependent(uuid,text,text,date) from public;
grant execute on function public.add_health_managed_dependent(uuid,text,text,date) to authenticated;

create or replace function public.audit_health_record_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_workspace uuid := coalesce((v_new->>'workspace_id')::uuid,(v_old->>'workspace_id')::uuid);
  v_profile uuid := coalesce(nullif(v_new->>'profile_id','')::uuid,nullif(v_old->>'profile_id','')::uuid);
  v_id text := coalesce(v_new->>'id',v_old->>'id');
begin
  if auth.uid() is null or not public.health_has_workspace_access(v_workspace) then
    raise exception 'Authenticated health workspace access is required.';
  end if;
  insert into public.health_audit_log(workspace_id,profile_id,table_name,record_id,action,actor_id,old_record,new_record)
  values(v_workspace,v_profile,tg_table_name,v_id,lower(tg_op),auth.uid(),v_old,v_new);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_health_record_change() from public;

do $$
declare t text;
begin
  foreach t in array array['health_workspace_members','health_profiles','health_conditions','health_care_team','health_provider_insurance_history','health_record_requests','health_authorizations','health_authorization_verifications','health_documents','health_extraction_proposals','health_lab_results','health_regimen_items','health_regimen_events','health_measurements','health_workouts','health_clinical_timeline','health_audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.health_has_workspace_access(workspace_id)) with check (public.health_has_workspace_access(workspace_id))', t || '_member_all', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['health_profiles','health_conditions','health_care_team','health_provider_insurance_history','health_record_requests','health_authorizations','health_authorization_verifications','health_documents','health_extraction_proposals','health_lab_results','health_regimen_items','health_regimen_events','health_measurements','health_workouts','health_clinical_timeline'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_health_record_change()', t || '_audit', t);
  end loop;
end $$;

alter table public.health_workspaces enable row level security;
alter table public.health_workspaces force row level security;
create policy health_workspaces_member_all on public.health_workspaces for all to authenticated
  using (public.health_has_workspace_access(id)) with check (public.health_has_workspace_access(id));

-- Membership is an explicit allowlist. Members can inspect it but cannot add a third person.
drop policy health_workspace_members_member_all on public.health_workspace_members;
create policy health_workspace_members_member_select on public.health_workspace_members
  for select to authenticated using (public.health_has_workspace_access(workspace_id));

create policy health_document_object_insert on storage.objects for insert to authenticated
  with check(bucket_id='health-documents' and public.health_has_workspace_access(((storage.foldername(name))[1])::uuid));
create policy health_document_object_select on storage.objects for select to authenticated
  using(bucket_id='health-documents' and exists(
    select 1 from public.health_documents document
    where document.object_path=storage.objects.name and document.bucket=storage.objects.bucket_id
      and public.health_has_workspace_access(document.workspace_id)
  ));

grant select on public.health_workspaces, public.health_workspace_members to authenticated;
grant select, insert, update on public.health_profiles, public.health_regimen_items to authenticated;
grant select, insert, update on public.health_conditions, public.health_care_team to authenticated;
grant select, insert, update on public.health_provider_insurance_history, public.health_record_requests to authenticated;
grant select, insert, update on public.health_authorizations, public.health_authorization_verifications to authenticated;
grant select, insert, update on public.health_documents, public.health_extraction_proposals to authenticated;
grant select, insert on public.health_lab_results, public.health_regimen_events,
  public.health_measurements, public.health_workouts, public.health_clinical_timeline to authenticated;
grant select on public.health_audit_log to authenticated;
