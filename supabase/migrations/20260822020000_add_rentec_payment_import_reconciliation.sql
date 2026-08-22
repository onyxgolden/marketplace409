-- Rentec external-payment reconciliation: lets a landlord import and approve rent payments that
-- were actually collected through Rentec, so an externally-managed FORGE charge correctly reflects
-- what a tenant has already paid before that lease is ever cut over to FORGE collection. Rentec
-- itself is never written to — this only ever reads Rentec transaction evidence (via the app layer)
-- and, on explicit landlord approval, records it as a FORGE rental_payments row.
--
-- This workflow is deliberately narrow: it never touches rent_schedules (no collection_mode change,
-- no cutover date), never touches rental_billing_settings (no global pause change), and never
-- inserts a new rent_charges row — it only updates the paid_amount_cents/status of an existing
-- charge that a landlord has explicitly approved a match against. It cannot enable Pay now, autopay,
-- or FORGE-collectible status for any lease.
--
-- NOT applied remotely by this change — local migration file only.

-- One row per approval ATTEMPT (applied or rejected) — this is both the audit trail and the
-- idempotency substrate. Rows are written only by approve_rentec_payment_import(), never by the
-- read-only preview path, so re-previewing never creates a row.
create table if not exists rentec_transaction_imports (
    id text primary key default ('rentec_txn_import_' || gen_random_uuid()::text),
    owner_id text not null,
    rentec_transaction_id text not null,
    lease_id text not null,
    charge_id text,
    payment_id text,
    amount_cents bigint not null check (amount_cents > 0),
    transaction_date date,
    category_name text,
    -- Rentec-side attribution at the moment this row was written — part of the "immutable
    -- evidence" a later re-preview compares fresh Rentec data against to detect drift (the
    -- transaction being reassigned to a different renter/property, not just its amount/date/type).
    rentec_renter_id text,
    rentec_property_id text,
    import_batch_id text not null,
    status text not null check (status in ('applied', 'rejected')),
    rejection_reason text,
    approved_by text not null,
    approved_at timestamptz not null default now(),
    foreign key (owner_id, lease_id) references rental_leases (owner_id, id) on delete restrict,
    foreign key (owner_id, charge_id) references rent_charges (owner_id, id) on delete restrict,
    foreign key (owner_id, payment_id) references rental_payments (owner_id, id) on delete restrict
);

-- The real idempotency guarantee: at most one 'applied' row can ever exist per (owner, Rentec
-- transaction id) — a second approval attempt for the same transaction can only ever land as a
-- no-op inside the function (checked first) or, as a last-resort safety net, fail this constraint.
create unique index if not exists idx_rentec_transaction_imports_applied_dedupe
  on rentec_transaction_imports (owner_id, rentec_transaction_id) where status = 'applied';
create index if not exists idx_rentec_transaction_imports_owner_batch
  on rentec_transaction_imports (owner_id, import_batch_id);
create index if not exists idx_rentec_transaction_imports_owner_txn
  on rentec_transaction_imports (owner_id, rentec_transaction_id);

alter table rentec_transaction_imports enable row level security;
alter table rentec_transaction_imports force row level security;
create policy "rentec_transaction_imports_owner_select" on rentec_transaction_imports
  for select to authenticated using (owner_id = auth.uid()::text);
-- Without this, approve_rentec_payment_import() — SECURITY INVOKER, so its writes run as the
-- calling 'authenticated' role — would have no policy permitting its own INSERT and every call
-- would fail with a row-level security violation, on every code path (applied and rejected alike).
create policy "rentec_transaction_imports_owner_insert" on rentec_transaction_imports
  for insert to authenticated with check (owner_id = auth.uid()::text);

-- Owner-authenticated, owner-scoped, idempotent, audited approval of a single previewed match.
-- Every match is rechecked here against the CURRENT charge/schedule state — the preview that
-- produced (p_lease_id, p_charge_id) may be stale by the time this is called (another payment could
-- have landed on the same charge, the lease could have been cut over to FORGE in the meantime,
-- etc.), so nothing from the client is trusted without a fresh read. A rejected recheck still
-- writes an audit row (status='rejected') rather than silently dropping the attempt.
create or replace function approve_rentec_payment_import(
    p_owner_id text,
    p_lease_id text,
    p_charge_id text,
    p_rentec_transaction_id text,
    p_amount_cents bigint,
    p_transaction_date date,
    p_category_name text,
    p_rentec_renter_id text,
    p_rentec_property_id text,
    p_import_batch_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_charge rent_charges%rowtype;
    v_schedule rent_schedules%rowtype;
    v_tenant_id text;
    v_payment_id text;
    v_new_paid bigint;
    v_new_status text;
    v_existing rentec_transaction_imports%rowtype;
    v_import_id text;
    v_reason text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rentec payment import owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_rentec_transaction_id is null or btrim(p_rentec_transaction_id) = '' then
        raise exception 'A stable Rentec transaction id is required.' using errcode = '22023';
    end if;
    if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'A positive transaction amount is required.' using errcode = '22023';
    end if;
    if p_import_batch_id is null or btrim(p_import_batch_id) = '' then
        raise exception 'An import batch id is required.' using errcode = '22023';
    end if;
    if p_lease_id is null or btrim(p_lease_id) = '' or p_charge_id is null or btrim(p_charge_id) = '' then
        raise exception 'A matched lease and charge are required.' using errcode = '22023';
    end if;

    -- Idempotent: a transaction already applied is a no-op, not an error — a retried approval
    -- (double-clicked button, resumed batch) can never double-pay the same charge.
    select * into v_existing from rentec_transaction_imports
      where owner_id = p_owner_id and rentec_transaction_id = p_rentec_transaction_id and status = 'applied'
      limit 1;
    if found then
        return jsonb_build_object('status', 'already_applied', 'importId', v_existing.id,
          'paymentId', v_existing.payment_id, 'chargeId', v_existing.charge_id);
    end if;

    v_import_id := 'rentec_txn_import_' || gen_random_uuid()::text;

    select * into v_charge from rent_charges
      where owner_id = p_owner_id and id = p_charge_id and lease_id = p_lease_id for update;
    if not found or v_charge.status = 'void' then
        v_reason := 'The matched rent charge no longer exists, belongs to a different lease, or has been voided.';
    else
        select s.* into v_schedule from rent_schedules s
          where s.owner_id = p_owner_id and s.lease_id = p_lease_id
          order by s.effective_start_date desc limit 1;
        if not found or v_schedule.collection_mode <> 'external' then
            v_reason := 'This lease is no longer externally managed; Rentec import no longer applies.';
        elsif p_amount_cents > v_charge.amount_cents - v_charge.paid_amount_cents then
            v_reason := 'Transaction amount exceeds the charge''s current remaining balance.';
        end if;
    end if;

    if v_reason is not null then
        insert into rentec_transaction_imports (id, owner_id, rentec_transaction_id, lease_id, charge_id,
          amount_cents, transaction_date, category_name, rentec_renter_id, rentec_property_id,
          import_batch_id, status, rejection_reason, approved_by)
        values (v_import_id, p_owner_id, p_rentec_transaction_id, p_lease_id, p_charge_id,
          p_amount_cents, p_transaction_date, p_category_name, p_rentec_renter_id, p_rentec_property_id,
          p_import_batch_id, 'rejected', v_reason, authenticated_owner_id);
        return jsonb_build_object('status', 'rejected', 'importId', v_import_id, 'reason', v_reason);
    end if;

    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = p_lease_id order by lt.tenant_id limit 1;
    if v_tenant_id is null then
        raise exception 'Lease tenant was not found.' using errcode = 'P0002';
    end if;

    v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
    v_new_paid := v_charge.paid_amount_cents + p_amount_cents;
    v_new_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;

    -- Nested block: the initial already_applied check (above) is not atomic with this write, so a
    -- truly concurrent second approval of the very same Rentec transaction can still reach this
    -- point after the first has committed. The unique partial index is the real guarantee against
    -- double-paying — but without this nested EXCEPTION handler, hitting it here would raise an
    -- unhandled error after the payment/charge writes below already ran, aborting the ENTIRE
    -- function call (a full rollback of this call's own writes, so the balance is never actually
    -- double-counted) but surfacing an ugly constraint-violation message instead of the graceful
    -- idempotent response every OTHER retry path returns. Catching it here converts that race into
    -- the same clean 'already_applied' result, backed by the winning call's own row.
    begin
        -- provider='rentec_external' is distinct from both 'stripe' and 'offline' so an imported
        -- Rentec payment is never conflated with a live Stripe charge or a manually recorded
        -- cash/check payment. No Stripe fields (provider_customer_id, a Stripe-shaped
        -- provider_payment_id, provider_mode) are ever populated here.
        insert into rental_payments (owner_id, id, charge_id, lease_id, tenant_id, provider, provider_payment_id,
          amount_cents, refunded_amount_cents, currency_code, status, idempotency_key, received_at, recorded_by,
          notes, created_at, updated_at, succeeded_at)
        values (p_owner_id, v_payment_id, v_charge.id, p_lease_id, v_tenant_id, 'rentec_external', p_rentec_transaction_id,
          p_amount_cents, 0, v_charge.currency_code, 'succeeded', 'rentec:' || p_rentec_transaction_id,
          coalesce(p_transaction_date::timestamptz, now()), authenticated_owner_id,
          nullif(btrim(coalesce(p_category_name, '')), ''), now(), now(), coalesce(p_transaction_date::timestamptz, now()));

        update rent_charges set paid_amount_cents = v_new_paid, status = v_new_status, updated_at = now()
          where owner_id = p_owner_id and id = v_charge.id;

        insert into rentec_transaction_imports (id, owner_id, rentec_transaction_id, lease_id, charge_id, payment_id,
          amount_cents, transaction_date, category_name, rentec_renter_id, rentec_property_id,
          import_batch_id, status, approved_by)
        values (v_import_id, p_owner_id, p_rentec_transaction_id, p_lease_id, v_charge.id, v_payment_id,
          p_amount_cents, p_transaction_date, p_category_name, p_rentec_renter_id, p_rentec_property_id,
          p_import_batch_id, 'applied', authenticated_owner_id);
    exception
        when unique_violation then
            select * into v_existing from rentec_transaction_imports
              where owner_id = p_owner_id and rentec_transaction_id = p_rentec_transaction_id and status = 'applied'
              limit 1;
            return jsonb_build_object('status', 'already_applied', 'importId', v_existing.id,
              'paymentId', v_existing.payment_id, 'chargeId', v_existing.charge_id);
    end;

    return jsonb_build_object('status', 'applied', 'importId', v_import_id, 'paymentId', v_payment_id,
      'chargeId', v_charge.id, 'newChargeStatus', v_new_status);
end;
$$;

revoke all on function approve_rentec_payment_import(text, text, text, text, bigint, date, text, text, text, text) from public;
grant execute on function approve_rentec_payment_import(text, text, text, text, bigint, date, text, text, text, text) to authenticated;
