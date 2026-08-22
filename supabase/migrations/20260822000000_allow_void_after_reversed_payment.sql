-- Fixes a gap discovered during the first live Stripe validation: void_rental_rent_charge only
-- ever checked paid_amount_cents = 0, which is an incomplete proxy for "no active payment
-- obligation" — paid_amount_cents is only incremented once a payment actually succeeds, so it
-- never blocked voiding a charge with a payment still in flight (created, requires_payment_method,
-- requires_action, processing). Meanwhile a charge whose only payment history is a fully refunded
-- (or failed/cancelled) payment has genuinely no outstanding obligation and must remain voidable —
-- paid_amount_cents = 0 already correctly allows that case; this migration makes the payment-state
-- check explicit instead of relying on paid_amount_cents alone, and closes the in-flight-payment gap.
--
-- NOT applied remotely by this change — local migration file only.

create or replace function void_rental_rent_charge(
    p_owner_id text,
    p_charge_id text,
    p_reason text
)
returns rent_charges
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    required_charge_id text := nullif(btrim(p_charge_id), '');
    required_reason text := nullif(btrim(p_reason), '');
    voided rent_charges%rowtype;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;

    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rent charge owner does not match authenticated owner.' using errcode = '42501';
    end if;

    if required_charge_id is null or required_reason is null then
        raise exception 'Rent charge id and a void reason are required.' using errcode = '22023';
    end if;

    update rent_charges
       set status = 'void',
           voided_at = now(),
           notes = concat_ws(' ', nullif(btrim(notes), ''), 'Voided: ' || required_reason),
           updated_at = now()
     where owner_id = p_owner_id
       and id = required_charge_id
       and paid_amount_cents = 0
       and status <> 'void'
       -- No payment for this charge may be in an active, pending, or otherwise unreversed state.
       -- 'refunded', 'failed', and 'cancelled' payments carry no outstanding money and never block
       -- voiding; every other status (including in-flight ones that haven't yet touched
       -- paid_amount_cents) does.
       and not exists (
         select 1 from rental_payments rp
          where rp.owner_id = p_owner_id
            and rp.charge_id = required_charge_id
            and rp.status not in ('refunded', 'failed', 'cancelled')
       )
     returning * into voided;

    return voided;
end;
$$;

revoke all on function void_rental_rent_charge(text, text, text) from public;
grant execute on function void_rental_rent_charge(text, text, text) to authenticated;
