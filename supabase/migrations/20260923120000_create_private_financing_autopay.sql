-- Private-financing autopay: recurring loan repayments via ACH (us_bank_account only).
-- Mirrors the rental_autopay_enrollments / rental_autopay_attempts architecture:
--   consent -> enrollment (setup_required) -> Stripe SetupIntent + mandate -> active
--   monthly sweep debits the stored bank payment method off-session.
-- New tables only; no data changes.

create table if not exists private_financing_autopay_enrollments (
  owner_id text not null,
  id text not null,
  account_id text not null,
  borrower_id text not null,
  status text not null default 'setup_required'
    check (status in ('setup_required','active','paused','cancelled')),
  payment_method_type text not null default 'us_bank_account'
    check (payment_method_type = 'us_bank_account'),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_method_id text,
  provider_mandate_id text,
  provider_customer_id text,
  setup_intent_id text,
  provider_mode text not null check (provider_mode in ('test','live')),
  charge_day smallint not null check (charge_day between 1 and 28),
  retry_limit smallint not null default 0 check (retry_limit between 0 and 3),
  reminder_days_before smallint not null default 3 check (reminder_days_before between 0 and 14),
  consent_text text not null,
  consented_at timestamptz not null,
  activated_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  consecutive_failures smallint not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, account_id) references private_financing_accounts(owner_id, id) on delete restrict,
  foreign key (owner_id, borrower_id) references private_financing_borrowers(owner_id, id) on delete restrict
);

-- One live enrollment per (owner, account, borrower): a borrower re-enrolling after a
-- cancel creates a new row only because the old one left the setup_required/active/paused set.
create unique index if not exists private_financing_autopay_one_current_enrollment
  on private_financing_autopay_enrollments(owner_id, account_id, borrower_id)
  where status in ('setup_required','active','paused');

-- One attempt per enrollment per billing month (billing_period 'YYYY-MM'): the sweep is
-- safe to re-run because a recorded attempt makes executePfAutopayAttempt a no-op.
create table if not exists private_financing_autopay_attempts (
  owner_id text not null,
  id text not null,
  enrollment_id text not null,
  billing_period text not null check (billing_period ~ '^[0-9]{4}-[0-9]{2}$'),
  payment_id text not null,
  provider_mode text not null check (provider_mode in ('test','live')),
  status text not null check (status in ('created','submitted','succeeded','failed','requires_action','cancelled')),
  idempotency_key text not null,
  provider_payment_id text,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, enrollment_id, billing_period),
  unique (idempotency_key),
  foreign key (owner_id, enrollment_id) references private_financing_autopay_enrollments(owner_id, id) on delete restrict,
  foreign key (owner_id, payment_id) references private_financing_online_payments(owner_id, id) on delete restrict
);

alter table private_financing_autopay_enrollments enable row level security;
alter table private_financing_autopay_enrollments force row level security;
alter table private_financing_autopay_attempts enable row level security;
alter table private_financing_autopay_attempts force row level security;

-- Owner workspace: full access (mirrors pf_online_settings_owner).
create policy "pf_autopay_enrollments_owner_all" on private_financing_autopay_enrollments
  for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
-- Borrower: reads only their own enrollments (the portal GET runs user-scoped).
create policy "pf_autopay_enrollments_borrower_read" on private_financing_autopay_enrollments
  for select to authenticated using (is_private_financing_borrower_identity(owner_id, borrower_id));
-- Attempt log: owner read only; borrowers never query it directly.
create policy "pf_autopay_attempts_owner_read" on private_financing_autopay_attempts
  for select to authenticated using (has_workspace_access(owner_id));
