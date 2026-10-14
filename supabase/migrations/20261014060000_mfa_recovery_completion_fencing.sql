-- Security Layer 2 — MFA recovery completion fencing (round 3).
--
-- L2-006A: recovery completion is fenced to ONE chosen factor and ONE
-- fenced completion owner/generation, persisted atomically on the recovery
-- operation BEFORE any provider factor deletion. Two concurrent ceremonies
-- (different admitted HTTP operation IDs) targeting the same recovery can
-- no longer each delete the other's new factor: the first claimer wins,
-- an alternative chosen factor is refused while the claim stands, and a
-- same-factor resume re-enters under the fenced lineage. An older
-- operation can never delete factors or clear a newer operation's latch:
-- begin refuses when a newer non-terminal operation exists, and finalize
-- re-checks before clearing the latch.
--
-- L2-006B support: no schema change (route-side validation ordering).
--
-- DEPLOY NOTE: migration file only. Applying to any database is a
-- separate, explicit Jason authorization (not granted by the build).

-- ---------------------------------------------------------------------------
-- Fencing columns on the recovery operation. NULL = no completion claimed
-- yet. (chosen_factor_id, completion_owner, completion_generation) are
-- always written together, atomically, under the operation row lock.
-- ---------------------------------------------------------------------------
alter table public.mfa_recovery_operations
  add column if not exists chosen_factor_id text,
  add column if not exists completion_owner text,
  add column if not exists completion_generation bigint;

-- Drop the round-2 signatures; the fenced versions below replace them.
-- (All Layer-2 migrations are still unapplied, so no live callers exist.)
drop function if exists public.mfa_recovery_begin_completion(uuid, text, text);
drop function if exists public.mfa_recovery_mark_factors_removed(uuid, text, text);
drop function if exists public.mfa_recovery_finalize(uuid, text, text);

-- ---------------------------------------------------------------------------
-- Begin (or resume) a FENCED completion.
--
-- Atomically (under the operation row lock) persists the chosen new
-- factor id + completion owner + generation BEFORE the gateway deletes
-- any provider factor:
--   * unclaimed operation  -> claims (chosen, owner, generation=1)
--   * same chosen factor   -> resume: generation bumps, the resuming
--     ceremony adopts the STORED owner (the fence lineage is single);
--     stale phase calls from an older generation are refused downstream
--   * different chosen     -> refused (refused=true, refused_reason=
--     'claimed'): the competing ceremony must NOT delete factors
--   * a newer non-terminal operation exists for this user -> refused
--     (refused_reason='stale_operation'): an older operation never
--     deletes factors or clears a newer latch
-- Terminal operations replay their disposition with no side effects.
--
-- Returns one row: (operation_created_at, status, terminal,
-- chosen_factor_id, completion_owner, completion_generation, refused,
-- refused_reason). refused_reason is null unless refused.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_recovery_begin_completion(
  p_user_id uuid,
  p_operation_id text,
  p_audit_id text,
  p_chosen_factor_id text,
  p_completion_owner text
)
returns table (
  operation_created_at timestamptz,
  status text,
  terminal boolean,
  chosen_factor_id text,
  completion_owner text,
  completion_generation bigint,
  refused boolean,
  refused_reason text
)
language plpgsql
as $$
declare
  v_created_at timestamptz;
  v_status text;
  v_chosen text;
  v_owner text;
  v_gen bigint;
begin
  if p_user_id is null or p_operation_id is null or p_audit_id is null
     or p_chosen_factor_id is null or p_completion_owner is null then
    raise exception 'mfa_recovery_begin_completion: invalid arguments';
  end if;

  insert into public.mfa_recovery_operations (id, user_id, status)
  values (p_operation_id, p_user_id, 'latched')
  on conflict (id) do nothing;

  select o.created_at, o.status, o.chosen_factor_id,
         o.completion_owner, o.completion_generation
    into v_created_at, v_status, v_chosen, v_owner, v_gen
    from public.mfa_recovery_operations o
   where o.id = p_operation_id
     and o.user_id = p_user_id
   for update;

  if not found then
    raise exception 'mfa_recovery_begin_completion: operation not owned by user';
  end if;

  operation_created_at := v_created_at;
  status := v_status;
  terminal := v_status in ('completed', 'failed');
  refused := false;
  refused_reason := null;

  if terminal then
    -- Terminal replay: disposition stands, no side effects, no fencing.
    chosen_factor_id := v_chosen;
    completion_owner := v_owner;
    completion_generation := v_gen;
    return next;
    return;
  end if;

  -- An older operation never deletes factors or clears a newer latch: a
  -- newer non-terminal operation owns the recovery now.
  if exists (
    select 1 from public.mfa_recovery_operations n
     where n.user_id = p_user_id
       and n.id <> p_operation_id
       and (n.created_at, n.id) > (v_created_at, p_operation_id)
       and n.status not in ('completed', 'failed')
  ) then
    refused := true;
    refused_reason := 'stale_operation';
    chosen_factor_id := v_chosen;
    completion_owner := v_owner;
    completion_generation := v_gen;
    return next;
    return;
  end if;

  if v_owner is null then
    -- First claimer wins: persist the fence atomically.
    update public.mfa_recovery_operations
       set chosen_factor_id = p_chosen_factor_id,
           completion_owner = p_completion_owner,
           completion_generation = 1,
           updated_at = now()
     where id = p_operation_id;
    chosen_factor_id := p_chosen_factor_id;
    completion_owner := p_completion_owner;
    completion_generation := 1;
  elsif v_chosen = p_chosen_factor_id then
    -- Same-factor resume: the fence lineage stays single. The resuming
    -- ceremony adopts the STORED owner; the generation bumps so phase
    -- calls from an older generation are refused downstream.
    update public.mfa_recovery_operations
       set completion_generation = v_gen + 1,
           updated_at = now()
     where id = p_operation_id;
    chosen_factor_id := v_chosen;
    completion_owner := v_owner;
    completion_generation := v_gen + 1;
  else
    -- A different chosen factor is refused while this completion owns
    -- the operation. No deletions, no phase advance.
    refused := true;
    refused_reason := 'claimed';
    chosen_factor_id := v_chosen;
    completion_owner := v_owner;
    completion_generation := v_gen;
    return next;
    return;
  end if;

  insert into public.mfa_audit_log (user_id, action, actor, audit_id, metadata)
  values (p_user_id, 'recovery_completion_began', 'gateway', p_audit_id,
          jsonb_build_object('operation_id', p_operation_id, 'status', v_status,
                             'chosen_factor_id', chosen_factor_id,
                             'completion_generation', completion_generation));

  return next;
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mark provider factor removal done: 'latched' -> 'factor_removed'.
-- Fenced: the presented (owner, generation) must match the stored fence;
-- stale phase calls are refused (false). Terminal replay is a no-op true.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_recovery_mark_factors_removed(
  p_user_id uuid,
  p_operation_id text,
  p_audit_id text,
  p_completion_owner text,
  p_completion_generation bigint
)
returns boolean
language plpgsql
as $$
declare
  v_status text;
  v_owner text;
  v_gen bigint;
begin
  if p_user_id is null or p_operation_id is null or p_audit_id is null
     or p_completion_owner is null or p_completion_generation is null then
    raise exception 'mfa_recovery_mark_factors_removed: invalid arguments';
  end if;

  select o.status, o.completion_owner, o.completion_generation
    into v_status, v_owner, v_gen
    from public.mfa_recovery_operations o
   where o.id = p_operation_id
     and o.user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;
  if v_status in ('completed', 'failed') then
    return true; -- terminal replay: disposition stands, no side effects
  end if;
  if v_status not in ('latched', 'factor_removed') then
    return false;
  end if;
  -- Fence check: only the current fence lineage advances the phase.
  if v_owner is null or v_owner <> p_completion_owner or v_gen <> p_completion_generation then
    return false;
  end if;

  update public.mfa_recovery_operations
     set status = 'factor_removed', updated_at = now()
   where id = p_operation_id;

  insert into public.mfa_audit_log (user_id, action, actor, audit_id, metadata)
  values (p_user_id, 'recovery_factors_removed', 'gateway', p_audit_id,
          jsonb_build_object('operation_id', p_operation_id));

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finalize: invalidate generations + mark completed + delete latch, in ONE
-- transaction. Only from 'factor_removed' (strict phase order). Fenced:
-- the presented (owner, generation) must match the stored fence, and a
-- newer non-terminal operation must not exist (an older operation never
-- clears a newer latch). Terminal replay is a no-op true.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_recovery_finalize(
  p_user_id uuid,
  p_operation_id text,
  p_audit_id text,
  p_completion_owner text,
  p_completion_generation bigint
)
returns boolean
language plpgsql
as $$
declare
  v_status text;
  v_owner text;
  v_gen bigint;
  v_created_at timestamptz;
begin
  if p_user_id is null or p_operation_id is null or p_audit_id is null
     or p_completion_owner is null or p_completion_generation is null then
    raise exception 'mfa_recovery_finalize: invalid arguments';
  end if;

  select o.status, o.completion_owner, o.completion_generation, o.created_at
    into v_status, v_owner, v_gen, v_created_at
    from public.mfa_recovery_operations o
   where o.id = p_operation_id
     and o.user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;
  if v_status in ('completed', 'failed') then
    return true; -- terminal replay: disposition stands, no side effects
  end if;
  if v_status <> 'factor_removed' then
    -- Strict phase order: factor removal must be recorded first.
    return false;
  end if;
  -- Fence check: only the current fence lineage finalizes.
  if v_owner is null or v_owner <> p_completion_owner or v_gen <> p_completion_generation then
    return false;
  end if;
  -- Never let an older operation clear a newer latch.
  if exists (
    select 1 from public.mfa_recovery_operations n
     where n.user_id = p_user_id
       and n.id <> p_operation_id
       and (n.created_at, n.id) > (v_created_at, p_operation_id)
       and n.status not in ('completed', 'failed')
  ) then
    return false;
  end if;

  update public.mfa_recovery_generations
     set invalidated_at = now()
   where user_id = p_user_id
     and invalidated_at is null;

  update public.mfa_recovery_operations
     set status = 'completed', updated_at = now()
   where id = p_operation_id;

  delete from public.mfa_security_latch
   where user_id = p_user_id;

  insert into public.mfa_audit_log (user_id, action, actor, audit_id, metadata)
  values (p_user_id, 'recovery_completed', 'gateway', p_audit_id,
          jsonb_build_object('operation_id', p_operation_id));

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Release a fenced completion claim (self-healing). Clears the
-- (chosen_factor_id, completion_owner, completion_generation) fence on a
-- non-terminal operation, but ONLY when the presented (owner, generation)
-- matches the stored fence — a stale ceremony cannot evict the live
-- claim. Used when the gateway's pre-finalize revalidation finds the
-- chosen factor no longer verified: without a release the operation
-- would wedge (no other factor could ever claim it). Terminal
-- operations are untouched.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_recovery_release_completion(
  p_user_id uuid,
  p_operation_id text,
  p_audit_id text,
  p_completion_owner text,
  p_completion_generation bigint
)
returns boolean
language plpgsql
as $$
declare
  v_status text;
  v_owner text;
  v_gen bigint;
begin
  if p_user_id is null or p_operation_id is null or p_audit_id is null
     or p_completion_owner is null or p_completion_generation is null then
    raise exception 'mfa_recovery_release_completion: invalid arguments';
  end if;

  select o.status, o.completion_owner, o.completion_generation
    into v_status, v_owner, v_gen
    from public.mfa_recovery_operations o
   where o.id = p_operation_id
     and o.user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;
  if v_status in ('completed', 'failed') then
    return false; -- terminal operations keep their disposition
  end if;
  if v_owner is null or v_owner <> p_completion_owner or v_gen <> p_completion_generation then
    return false; -- a stale ceremony cannot evict the live claim
  end if;

  update public.mfa_recovery_operations
     set chosen_factor_id = null,
         completion_owner = null,
         completion_generation = null,
         updated_at = now()
   where id = p_operation_id;

  insert into public.mfa_audit_log (user_id, action, actor, audit_id, metadata)
  values (p_user_id, 'recovery_completion_released', 'gateway', p_audit_id,
          jsonb_build_object('operation_id', p_operation_id));

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: service-role only (same posture as the round-2 RPCs).
-- ---------------------------------------------------------------------------
do $$
declare
  sig text;
begin
  foreach sig in array array[
    'public.mfa_recovery_begin_completion(uuid,text,text,text,text)',
    'public.mfa_recovery_mark_factors_removed(uuid,text,text,text,bigint)',
    'public.mfa_recovery_finalize(uuid,text,text,text,bigint)',
    'public.mfa_recovery_release_completion(uuid,text,text,text,bigint)'
  ] loop
    execute format('revoke all on function %s from public', sig);
    execute format('revoke all on function %s from anon', sig);
    execute format('revoke all on function %s from authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end
$$;

-- Re-applying this migration is a no-op: ADD COLUMN IF NOT EXISTS, DROP
-- FUNCTION IF EXISTS + CREATE OR REPLACE, and idempotent revoke/grant
-- statements leave existing rows untouched. Fencing columns default to
-- NULL (unclaimed); in-flight round-2 operations simply have no fence
-- until their next begin call claims one.
