-- Adds per-schedule early-pay window (days before due date that next month's
-- charge becomes available). NOT YET APPLIED IN PRODUCTION.
alter table public.rent_schedules
  add column if not exists early_pay_days integer not null default 7
  check (early_pay_days >= 0 and early_pay_days <= 31);

comment on column public.rent_schedules.early_pay_days is
  'Days before the due date that next month''s rent charge is generated so the tenant can pay ahead. 0 = only on/after due-date month starts.';
