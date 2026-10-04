-- ---------------------------------------------------------------------------
-- FORGE Work Management — Rung 3: Readiness engine ("can this work start?")
--
-- Two tables:
--   forge_work_gate_evaluations — append-only history of gate checks.
--     Each row is one evaluation of one gate on one package: the verdict
--     (ready / not_ready / unknown), the human-readable reason, and the
--     structured evidence the verdict was computed from. History is never
--     rewritten — today's "not ready" is tomorrow's audit trail.
--   forge_work_gate_overrides — authorized human overrides.
--     An override does NOT change the evaluation. It is a separate human
--     decision ("go anyway") with a reason, an actor, and an expiry. When
--     the override lapses, the underlying evaluation governs again.
--
-- Readiness rule (enforced in the domain layer, surfaced to the Rung 1
-- lifecycle): a gate is SATISFIED for a package when either
--   (a) the latest evaluation verdict is 'ready', or
--   (b) an unexpired override exists for that gate on that package.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- forge_work_gate_evaluations
-- ---------------------------------------------------------------------------
create table if not exists forge_work_gate_evaluations (
  owner_id text not null,
  id text not null default ('forge_wge_' || gen_random_uuid()::text),
  package_id text not null,
  gate text not null,
  verdict text not null,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  evaluated_by text not null default 'system',
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_gate_evaluations_gate_check check (gate in (
    'scope','design','predecessor','material','crew','permit','site','safety',
    'evidence','equipment_readiness','inspection_prerequisite','logistics')),
  constraint forge_work_gate_evaluations_verdict_check check (verdict in (
    'ready','not_ready','unknown'))
);
create index if not exists forge_work_gate_evaluations_pkg_idx
  on forge_work_gate_evaluations (owner_id, package_id, gate, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- forge_work_gate_overrides
-- ---------------------------------------------------------------------------
create table if not exists forge_work_gate_overrides (
  owner_id text not null,
  id text not null default ('forge_wgo_' || gen_random_uuid()::text),
  package_id text not null,
  gate text not null,
  override_by text not null,
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint forge_work_gate_overrides_gate_check check (gate in (
    'scope','design','predecessor','material','crew','permit','site','safety',
    'evidence','equipment_readiness','inspection_prerequisite','logistics')),
  constraint forge_work_gate_overrides_expiry_check check (expires_at > created_at)
);
create index if not exists forge_work_gate_overrides_pkg_idx
  on forge_work_gate_overrides (owner_id, package_id, gate, expires_at desc);

-- ---------------------------------------------------------------------------
-- RLS: workspace-scoped (mirrors Rung 1). has_workspace_access(owner_id)
-- admits the workspace owner and active members; cross-workspace reads and
-- writes are rejected at the database layer.
-- ---------------------------------------------------------------------------
alter table forge_work_gate_evaluations enable row level security;
alter table forge_work_gate_overrides enable row level security;

drop policy if exists forge_work_gate_evaluations_workspace_select on forge_work_gate_evaluations;
create policy forge_work_gate_evaluations_workspace_select on forge_work_gate_evaluations
  for select to authenticated using (has_workspace_access(owner_id));

drop policy if exists forge_work_gate_evaluations_workspace_insert on forge_work_gate_evaluations;
create policy forge_work_gate_evaluations_workspace_insert on forge_work_gate_evaluations
  for insert to authenticated with check (has_workspace_access(owner_id));

drop policy if exists forge_work_gate_overrides_workspace_select on forge_work_gate_overrides;
create policy forge_work_gate_overrides_workspace_select on forge_work_gate_overrides
  for select to authenticated using (has_workspace_access(owner_id));

drop policy if exists forge_work_gate_overrides_workspace_insert on forge_work_gate_overrides;
create policy forge_work_gate_overrides_workspace_insert on forge_work_gate_overrides
  for insert to authenticated with check (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Append-only: evaluations are never updated or deleted. Overrides are
-- never updated (a mistaken override is superseded by expiry, not edited);
-- deletion is left to the application layer via service role if ever needed.
-- ---------------------------------------------------------------------------
create or replace function forge_work_gate_evaluations_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: gate evaluations are append-only';
end $$;

drop trigger if exists forge_work_gate_evaluations_no_update_trg on forge_work_gate_evaluations;
create trigger forge_work_gate_evaluations_no_update_trg
  before update or delete on forge_work_gate_evaluations
  for each row execute function forge_work_gate_evaluations_no_update();

create or replace function forge_work_gate_overrides_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: gate overrides are immutable; let them expire';
end $$;

drop trigger if exists forge_work_gate_overrides_no_update_trg on forge_work_gate_overrides;
create trigger forge_work_gate_overrides_no_update_trg
  before update on forge_work_gate_overrides
  for each row execute function forge_work_gate_overrides_no_update();

-- ---------------------------------------------------------------------------
-- Attribution: stamp the true caller.
--   Evaluations: evaluated_by defaults to 'system'. A human caller is
--     stamped with their identity (a human can run an evaluation manually).
--   Overrides: override_by is ALWAYS the human caller. A service-role
--     (no-JWT) override is rejected — overrides are human decisions.
-- ---------------------------------------------------------------------------
create or replace function forge_work_gate_evaluations_stamp()
returns trigger language plpgsql as $$
declare v_caller text := nullif(auth.uid()::text, '');
declare v_att record;
declare v_computed text;
declare v_reason text;
declare v_has_attestation boolean;
begin
  if v_caller is not null then
    NEW.evaluated_by := v_caller;
  end if;
  -- Fabricated future timestamps would let a verdict govern before its
  -- evidence exists. Evaluations are recorded at evaluation time.
  if NEW.evaluated_at > now() + interval '5 minutes' then
    raise exception 'forge_work: evaluation timestamp cannot be in the future';
  end if;
  -- The verdict is COMPUTED here, not accepted from the writer. The ONLY
  -- trusted input is the attestation record. Caller-supplied signals in
  -- evidence.signals are IGNORED entirely: they are writer-controlled and
  -- cannot serve as the basis for a trusted calculation. (When
  -- authoritative material/crew/permit/predecessor tables land in later
  -- rungs, this trigger will derive signals from those records directly.)
  --
  -- A direct write claiming "ready" is rewritten to whatever the
  -- attestation supports. There is no path to a fabricated ready.
  select * into v_att from forge_work_gate_attestations
    where owner_id = NEW.owner_id
      and package_id = NEW.package_id
      and gate = NEW.gate
    order by at desc limit 1;
  -- FOUND is the correct test for SELECT INTO; "v_att is not null" does
  -- not work for record variables (it tests field nullness, not row presence).
  v_has_attestation := FOUND;
  if not v_has_attestation then
    v_computed := 'unknown';
    v_reason := 'No attestation recorded for this gate.';
  elsif v_att.not_applicable then
    if v_att.na_reason is not null and btrim(v_att.na_reason) <> '' then
      v_computed := 'ready';
      v_reason := 'Gate waived: ' || btrim(v_att.na_reason);
    else
      v_computed := 'unknown';
      v_reason := 'Gate marked not-applicable without a reason.';
    end if;
  else
    v_computed := 'ready';
    v_reason := coalesce(v_att.statement, 'Attested ready.');
  end if;
  NEW.verdict := v_computed;
  NEW.reason := v_reason;
  -- Sanitized evidence records whether an attestation actually exists.
  -- Caller-supplied evidence is stripped; the flag reflects the lookup.
  NEW.evidence := jsonb_build_object('attested', v_has_attestation);
  return NEW;
end $$;

drop trigger if exists forge_work_gate_evaluations_stamp_trg on forge_work_gate_evaluations;
create trigger forge_work_gate_evaluations_stamp_trg
  before insert on forge_work_gate_evaluations
  for each row execute function forge_work_gate_evaluations_stamp();

create or replace function forge_work_gate_overrides_stamp()
returns trigger language plpgsql as $$
declare v_caller text := nullif(auth.uid()::text, '');
begin
  if v_caller is null then
    raise exception 'forge_work: gate overrides require a human actor';
  end if;
  NEW.override_by := v_caller;
  -- The application layer validates these too, but direct writes bypass
  -- the application: the database enforces them independently.
  if NEW.reason is null or btrim(NEW.reason) = '' then
    raise exception 'forge_work: gate override requires a reason';
  end if;
  if NEW.expires_at <= now() then
    raise exception 'forge_work: gate override expiry must be in the future';
  end if;
  if NEW.expires_at > now() + interval '30 days' then
    raise exception 'forge_work: gate override expiry cannot exceed 30 days';
  end if;
  return NEW;
end $$;

drop trigger if exists forge_work_gate_overrides_stamp_trg on forge_work_gate_overrides;
create trigger forge_work_gate_overrides_stamp_trg
  before insert on forge_work_gate_overrides
  for each row execute function forge_work_gate_overrides_stamp();
