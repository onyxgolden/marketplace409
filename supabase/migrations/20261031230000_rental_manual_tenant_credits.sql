-- Controls sweep B4: standalone tenant credits (no overpayment required).
--
-- A manual credit has no source payment by definition, so the source set gains
-- 'manual' and source_payment_id becomes nullable — but the overpayment audit
-- anchor is preserved: an overpayment credit must still carry its payment id.
-- (PostgreSQL names an inline column CHECK as {table}_{column}_check, hence
-- rental_tenant_credits_source_check below.)
alter table rental_tenant_credits drop constraint if exists rental_tenant_credits_source_check;
alter table rental_tenant_credits add constraint rental_tenant_credits_source_check
  check (source in ('overpayment', 'manual'));
alter table rental_tenant_credits alter column source_payment_id drop not null;
alter table rental_tenant_credits add constraint rental_tenant_credits_overpayment_requires_payment
  check (source <> 'overpayment' or source_payment_id is not null);
