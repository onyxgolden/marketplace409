-- Overpayment-credit auto-apply for the generation cron (Barnhill lesson: the
-- $666.13 overpayment credit sat open while November's full charge went out,
-- and needed a hand application).
--
-- Why a new function instead of reusing generate_monthly_rent_charge: the live
-- cron generates charges through the JS domain (which handles R13 weekly /
-- bi-weekly periods), not through that RPC, so its built-in auto-apply never
-- runs on the cron path. This helper does ONLY the credit half, atomically,
-- and the cron calls it right after inserting a freshly generated charge.
-- The caller must only invoke it for freshly inserted charges (it checks the
-- charge is payable, and LEAST math makes a repeat call a no-op once credits
-- are consumed or the charge is fully paid — but "newly generated" is the
-- caller's contract, mirroring generate_monthly_rent_charge's inserted_id
-- gate).
--
-- Conventions mirrored from apply_rental_tenant_credit and
-- generate_monthly_rent_charge: lock order (charge before credits, so
-- concurrent generation and manual application can never deadlock), FIFO
-- order (created_at, id), LEAST(credit remaining, charge remaining) math,
-- application id 'rental_credit_application_' + uuid, note
-- 'Auto-applied to generated charge ' + period, and charge status
-- re-derivation (paid when fully covered, else partially_paid).
--
-- Two deliberate differences from the legacy loop:
-- - source = 'overpayment' ONLY. The legacy loop predates manual credits and
--   applies every open credit; manual credits stay hand-applied by design
--   (an owner may intend to hold them).
-- - applied_by = p_owner_id, not auth.uid(): the cron runs under the
--   service-role key, where auth.uid() is null. There is no
--   has_workspace_access check here for the same reason — the trust boundary
--   is the service-role caller (the cron already filters schedules by its
--   billing-enabled owner allowlist), and execute is granted to service_role
--   only.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching
-- production. The cron degrades gracefully without it (generation succeeds,
-- auto-apply is skipped with an error log) until this lands.

create or replace function apply_overpayment_credits_to_charge(
  p_owner_id text,
  p_charge_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge rent_charges%rowtype;
  v_credit rental_tenant_credits%rowtype;
  v_charge_remaining bigint;
  v_apply_cents bigint;
  v_application_id text;
  v_new_credit_remaining bigint;
  v_new_credit_status text;
  v_new_paid bigint;
  v_new_charge_status text;
  v_applied_cents bigint := 0;
  v_application_count integer := 0;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' then
    raise exception 'Owner id is required.' using errcode = 'P0001';
  end if;
  if p_charge_id is null or btrim(p_charge_id) = '' then
    raise exception 'Charge id is required.' using errcode = 'P0001';
  end if;

  -- Lock order (charge before credits) matches apply_rental_tenant_credit and
  -- generate_monthly_rent_charge.
  select * into v_charge from rent_charges
    where owner_id = p_owner_id and id = p_charge_id for update;
  if not found then
    raise exception 'Rent charge was not found.' using errcode = 'P0001';
  end if;
  if v_charge.status = 'void' then
    raise exception 'Rent charge is not payable.' using errcode = 'P0001';
  end if;
  if v_charge.status = 'paid' then
    return jsonb_build_object('chargeId', v_charge.id, 'appliedCents', 0, 'applicationCount', 0);
  end if;

  v_charge_remaining := v_charge.amount_cents - v_charge.paid_amount_cents;
  for v_credit in
    select * from rental_tenant_credits
      where owner_id = p_owner_id and lease_id = v_charge.lease_id and status = 'open'
        and source = 'overpayment' and remaining_cents > 0
      order by created_at asc, id asc
      for update
  loop
    exit when v_charge_remaining <= 0;
    v_apply_cents := least(v_credit.remaining_cents, v_charge_remaining);
    v_application_id := 'rental_credit_application_' || gen_random_uuid()::text;
    insert into rental_credit_applications (owner_id, id, credit_id, tenant_id, lease_id,
      charge_id, amount_cents, applied_at, applied_by, notes)
    values (p_owner_id, v_application_id, v_credit.id, v_credit.tenant_id, v_credit.lease_id,
      v_charge.id, v_apply_cents, now(), p_owner_id,
      'Auto-applied to generated charge ' || v_charge.period);
    v_new_credit_remaining := v_credit.remaining_cents - v_apply_cents;
    v_new_credit_status := case when v_new_credit_remaining = 0 then 'fully_applied' else 'open' end;
    update rental_tenant_credits set remaining_cents = v_new_credit_remaining,
      status = v_new_credit_status, updated_at = now()
      where owner_id = p_owner_id and id = v_credit.id;
    v_charge_remaining := v_charge_remaining - v_apply_cents;
    v_applied_cents := v_applied_cents + v_apply_cents;
    v_application_count := v_application_count + 1;
  end loop;

  if v_applied_cents > 0 then
    v_new_paid := v_charge.amount_cents - v_charge_remaining;
    v_new_charge_status := case when v_charge_remaining = 0 then 'paid' else 'partially_paid' end;
    update rent_charges set paid_amount_cents = v_new_paid, status = v_new_charge_status, updated_at = now()
      where owner_id = p_owner_id and id = v_charge.id;
  end if;

  return jsonb_build_object('chargeId', v_charge.id, 'appliedCents', v_applied_cents,
    'applicationCount', v_application_count);
end;
$$;

revoke all on function apply_overpayment_credits_to_charge(text, text) from public;
grant execute on function apply_overpayment_credits_to_charge(text, text) to service_role;
