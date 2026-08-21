-- Adds an explicit Stripe provider_mode ('test' | 'live') to every table that stores a
-- Stripe-created identifier, so sandbox rows created under test keys can never be mistaken for
-- live financial activity once Production switches to live keys, and a live connected
-- account/customer/payment/settlement can never be blocked by, or silently overwrite, a
-- preserved sandbox row.
--
-- provider_mode is nullable at the column level (a non-Stripe row — e.g. an 'offline' recorded
-- payment — has no meaningful mode) but is required via a CHECK wherever provider = 'stripe',
-- so every real Stripe-backed row is unambiguously tagged. All existing rows in this database
-- were created against Stripe *test* keys (FORGE has never held live keys), so every existing
-- provider='stripe' row is backfilled to 'test' before the NOT-NULL-when-stripe check is added.
-- Nothing is deleted or rewritten beyond this one new column.
--
-- NOT applied remotely by this change — local migration file only.

-- ---------------------------------------------------------------------------------------------
-- Small helper, scoped to this migration only (pg_temp), to drop a unique constraint by its exact
-- column set rather than by a guessed auto-generated name. Postgres deterministically names an
-- unnamed UNIQUE constraint `<table>_<col1>_..._key`, but truncates/hashes names that exceed the
-- 63-byte identifier limit — which two of the constraints below do — so guessing would be unsafe.
create function pg_temp.drop_unique_constraint_by_columns(p_table text, p_columns text[]) returns void as $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = p_table and con.contype = 'u'
    and (
      select array_agg(a.attname::text order by k.ord)
      from unnest(con.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
    ) = p_columns;
  if v_name is not null then
    execute format('alter table %I drop constraint %I', p_table, v_name);
  end if;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------------------------
-- landlord_payment_accounts
alter table landlord_payment_accounts add column if not exists provider_mode text check (provider_mode in ('test','live'));
update landlord_payment_accounts set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table landlord_payment_accounts add constraint landlord_payment_accounts_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

alter table landlord_payment_accounts drop constraint if exists landlord_payment_accounts_owner_id_provider_key;
alter table landlord_payment_accounts add constraint landlord_payment_accounts_owner_id_provider_provider_mode_key
  unique (owner_id, provider, provider_mode);

alter table landlord_payment_accounts drop constraint if exists landlord_payment_accounts_provider_provider_account_id_key;
alter table landlord_payment_accounts add constraint landlord_payment_accounts_provider_provider_mode_account_id_key
  unique (provider, provider_mode, provider_account_id);

-- ---------------------------------------------------------------------------------------------
-- billing_customer_references
alter table billing_customer_references add column if not exists provider_mode text check (provider_mode in ('test','live'));
update billing_customer_references set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table billing_customer_references add constraint billing_customer_references_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

alter table billing_customer_references drop constraint if exists billing_customer_references_pkey;
alter table billing_customer_references add constraint billing_customer_references_pkey
  primary key (owner_id, tenant_id, provider, provider_mode);

select pg_temp.drop_unique_constraint_by_columns('billing_customer_references',
  array['provider','connected_account_id','customer_id']);
alter table billing_customer_references add constraint billing_customer_references_provider_mode_account_customer_key
  unique (provider, provider_mode, connected_account_id, customer_id);

-- ---------------------------------------------------------------------------------------------
-- rental_payments
alter table rental_payments add column if not exists provider_mode text check (provider_mode in ('test','live'));
update rental_payments set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table rental_payments add constraint rental_payments_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

alter table rental_payments drop constraint if exists rental_payments_provider_provider_payment_id_key;
alter table rental_payments add constraint rental_payments_provider_provider_mode_payment_id_key
  unique (provider, provider_mode, provider_payment_id);

-- ---------------------------------------------------------------------------------------------
-- rental_settlements
alter table rental_settlements add column if not exists provider_mode text check (provider_mode in ('test','live'));
update rental_settlements set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table rental_settlements add constraint rental_settlements_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

select pg_temp.drop_unique_constraint_by_columns('rental_settlements',
  array['provider','provider_balance_transaction_id']);
alter table rental_settlements add constraint rental_settlements_provider_mode_balance_txn_key
  unique (provider, provider_mode, provider_balance_transaction_id);

-- ---------------------------------------------------------------------------------------------
-- payment_webhook_events — mode is recorded from the event's own claimed livemode (validated
-- against the server's configured mode by application code before any business mutation runs;
-- see stripe-webhook and stripe-account-webhook routes). Existing rows predate this column and
-- were all received under test keys.
alter table payment_webhook_events add column if not exists provider_mode text check (provider_mode in ('test','live'));
update payment_webhook_events set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table payment_webhook_events add constraint payment_webhook_events_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

alter table payment_webhook_events drop constraint if exists payment_webhook_events_provider_provider_event_id_key;
alter table payment_webhook_events add constraint payment_webhook_events_provider_mode_event_id_key
  unique (provider, provider_mode, provider_event_id);

-- ---------------------------------------------------------------------------------------------
-- rental_autopay_enrollments — a preserved sandbox enrollment must never be picked up by a live
-- autopay sweep. Tagging it and scoping the "one current enrollment" index by mode is sufficient:
-- the sweep query (application code) filters by the server's configured mode, so a test-mode
-- 'active' enrollment is simply invisible to a live-mode sweep — no status rewrite is needed or
-- performed here, preserving the sandbox row exactly as it was.
alter table rental_autopay_enrollments add column if not exists provider_mode text not null default 'test' check (provider_mode in ('test','live'));
alter table rental_autopay_enrollments alter column provider_mode drop default;

drop index if exists rental_autopay_one_current_enrollment;
create unique index rental_autopay_one_current_enrollment
  on rental_autopay_enrollments (owner_id, lease_id, tenant_id, provider_mode)
  where status in ('setup_required','active','paused');

-- ---------------------------------------------------------------------------------------------
-- rental_autopay_attempts — tagged for audit/consistency; its existing uniqueness
-- (owner_id,enrollment_id,charge_id) and (idempotency_key) already can't collide across mode in
-- practice (a given charge_id only has one PaymentIntent attempt lineage), so no constraint change.
alter table rental_autopay_attempts add column if not exists provider_mode text not null default 'test' check (provider_mode in ('test','live'));
alter table rental_autopay_attempts alter column provider_mode drop default;

-- ---------------------------------------------------------------------------------------------
-- ach_authorizations — no application code currently reads or writes this table (confirmed dead
-- code); tagged only for schema completeness/consistency with the rest of this migration.
alter table ach_authorizations add column if not exists provider_mode text check (provider_mode in ('test','live'));
update ach_authorizations set provider_mode = 'test' where provider_mode is null and provider = 'stripe';
alter table ach_authorizations add constraint ach_authorizations_provider_mode_required
  check (provider <> 'stripe' or provider_mode is not null);

drop function pg_temp.drop_unique_constraint_by_columns(text, text[]);
